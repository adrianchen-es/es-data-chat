# cache-service/src/cache.py
import redis.asyncio as redis
import json
import hashlib
import numpy as np
import httpx
from typing import Protocol
from typing import Optional, Dict, Any
import time
import os
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

class EmbeddingProvider(Protocol):
    def encode(self, text: str) -> np.ndarray:
        ...


class OpenAIEmbeddingProvider:
    def __init__(self, api_key: str = None, model: str = "text-embedding-3-small"):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.model = model

    def encode(self, text: str) -> np.ndarray:
        if not self.api_key:
            raise RuntimeError("OpenAI API key not configured")
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {"model": self.model, "input": text}
        resp = httpx.post("https://api.openai.com/v1/embeddings", json=payload, headers=headers, timeout=30.0)
        resp.raise_for_status()
        j = resp.json()
        vec = np.array(j["data"][0]["embedding"], dtype=np.float32)
        return vec


class LocalHashEmbeddingProvider:
    """A very small, deterministic embedding fallback using n-gram hashing.
    Not semantically meaningful but useful as a small dependency-free fallback for dev/local use.
    """
    def __init__(self, dim: int = 128):
        self.dim = dim

    def encode(self, text: str) -> np.ndarray:
        # simple n-gram hashing into fixed-size vector
        vec = np.zeros(self.dim, dtype=np.float32)
        s = text.lower()
        for i in range(len(s)):
            ngram = s[i:i+3]
            h = int(hashlib.sha256(ngram.encode()).hexdigest(), 16)
            idx = h % self.dim
            vec[idx] += 1.0
        # normalize
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec


class SemanticCache:
    def __init__(self, redis_client, model_name: str = "all-MiniLM-L6-v2", threshold=0.85, provider: EmbeddingProvider = None):
        self.redis = redis_client
        self.threshold = threshold
        # select provider: prefer explicit provider, then OpenAI if key present, else local fallback
        if provider is not None:
            self.encoder = provider
        else:
            if os.getenv("OPENAI_API_KEY"):
                self.encoder = OpenAIEmbeddingProvider()
            else:
                self.encoder = LocalHashEmbeddingProvider(dim=128)
    
    def _cache_key(self, query: str, context: str = "") -> str:
        """Generate cache key"""
        data = {"query": query, "context": context}
        return f"semantic:{hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()}"
    
    async def get_similar(self, query: str, context: str = "") -> Optional[Dict]:
        """Find semantically similar cached response"""
        with tracer.start_as_current_span("semantic_cache_lookup") as span:
            query_embedding = self.encoder.encode(query)
            
            cursor = "0"
            best_match = None
            best_similarity = 0
            
            while True:
                cursor, keys = await self.redis.scan(cursor, match="semantic:*", count=50)
                
                for key in keys:
                    cached_data = await self.redis.hgetall(key)
                    if cached_data:
                        cached_embedding = np.frombuffer(
                            cached_data[b'embedding'], dtype=np.float32
                        )
                        
                        similarity = np.dot(query_embedding, cached_embedding) / (
                            np.linalg.norm(query_embedding) * np.linalg.norm(cached_embedding)
                        )
                        
                        if similarity > self.threshold and similarity > best_similarity:
                            best_similarity = similarity
                            best_match = json.loads(cached_data[b'response'])
                
                if cursor == "0":
                    break
            
            span.set_attributes({
                "cache.hit": best_match is not None,
                "cache.similarity": best_similarity
            })
            
            return best_match
    
    async def cache_response(self, query: str, response: Dict, context: str = "", ttl: int = 3600):
        """Cache response with embeddings"""
        with tracer.start_as_current_span("semantic_cache_store"):
            cache_key = self._cache_key(query, context)
            query_embedding = self.encoder.encode(query)
            
            cache_data = {
                'response': json.dumps(response),
                'embedding': query_embedding.tobytes(),
                'query': query,
                'timestamp': time.time()
            }
            
            await self.redis.hset(cache_key, mapping=cache_data)
            await self.redis.expire(cache_key, ttl)

class MultiLayerCache:
    def __init__(self, redis_url: str = None):
        self.redis = redis.from_url(
            redis_url or os.getenv('REDIS_URL', 'redis://localhost:6379')
        )
        self.l1_cache = {}  # In-memory cache
        self.semantic_cache = SemanticCache(self.redis)
    
    async def get(self, key: str, query_fn=None, ttl: int = 3600, semantic_key: str = None):
        """Multi-layer cache retrieval"""
        with tracer.start_as_current_span("multilayer_cache_get") as span:
            span.set_attribute("cache.key", key)
            
            # L1 Cache (Memory)
            if key in self.l1_cache:
                span.set_attribute("cache.layer", "L1")
                return self.l1_cache[key]
            
            # L2 Cache (Redis)
            result = await self.redis.get(key)
            if result:
                span.set_attribute("cache.layer", "L2")
                deserialized = json.loads(result)
                self.l1_cache[key] = deserialized
                return deserialized
            
            # L3 Cache (Semantic)
            if semantic_key:
                semantic_result = await self.semantic_cache.get_similar(semantic_key)
                if semantic_result:
                    span.set_attribute("cache.layer", "L3_semantic")
                    await self.set(key, semantic_result, ttl)
                    return semantic_result
            
            # Cache miss - compute if function provided
            if query_fn:
                span.set_attribute("cache.layer", "miss")
                result = await query_fn()
                await self.set(key, result, ttl, semantic_key)
                return result
            
            return None
    
    async def set(self, key: str, value: Any, ttl: int = 3600, semantic_key: str = None):
        """Multi-layer cache storage"""
        with tracer.start_as_current_span("multilayer_cache_set"):
            # L1 Cache
            self.l1_cache[key] = value
            
            # L2 Cache
            await self.redis.setex(key, ttl, json.dumps(value, default=str))
            
            # L3 Cache (Semantic)
            if semantic_key:
                await self.semantic_cache.cache_response(semantic_key, value, ttl=ttl)
    
    async def invalidate(self, pattern: str = None):
        """Invalidate cache entries"""
        if pattern:
            keys = await self.redis.keys(pattern)
            if keys:
                await self.redis.delete(*keys)
        
        # Clear L1 cache
        if pattern and "*" in pattern:
            prefix = pattern.replace("*", "")
            self.l1_cache = {k: v for k, v in self.l1_cache.items() if not k.startswith(prefix)}
        else:
            self.l1_cache.clear()

# cache-service/src/main.py
from fastapi import FastAPI, HTTPException
from .cache import MultiLayerCache
import os
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

app = FastAPI(title="Cache Service", version="1.0.0")
FastAPIInstrumentor.instrument_app(app)
tracer = trace.get_tracer(__name__)

cache = MultiLayerCache()

@app.get("/cache/{key}")
async def get_cache(key: str):
    """Get cached value"""
    with tracer.start_as_current_span("cache_get") as span:
        span.set_attribute("cache.key", key)
        result = await cache.get(key)
        span.set_attribute("cache.hit", result is not None)
        return {"key": key, "value": result, "found": result is not None}

@app.post("/cache/{key}")
async def set_cache(key: str, value: dict, ttl: int = 3600):
    """Set cached value"""
    with tracer.start_as_current_span("cache_set") as span:
        span.set_attributes({
            "cache.key": key,
            "cache.ttl": ttl
        })
        await cache.set(key, value, ttl)
        return {"status": "cached", "key": key, "ttl": ttl}

@app.delete("/cache")
async def clear_cache(pattern: str = "*"):
    """Clear cache entries"""
    with tracer.start_as_current_span("cache_clear") as span:
        span.set_attribute("cache.pattern", pattern)
        await cache.invalidate(pattern)
        return {"status": "cleared", "pattern": pattern}

@app.get("/health")
async def health_check():
    """Health check"""
    try:
        await cache.redis.ping()
        return {"status": "healthy", "service": "cache"}
    except Exception:
        return {"status": "unhealthy", "service": "cache"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)