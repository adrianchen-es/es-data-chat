# vector-service/src/main.py
from fastapi import FastAPI, HTTPException
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from sentence_transformers import SentenceTransformer
import numpy as np
import uuid
from typing import List, Dict, Optional
import os
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

app = FastAPI(title="Vector Database Service", version="1.0.0")
FastAPIInstrumentor.instrument_app(app)
tracer = trace.get_tracer(__name__)

# Initialize clients
qdrant_client = AsyncQdrantClient(
    host=os.getenv("QDRANT_HOST", "qdrant"),
    port=int(os.getenv("QDRANT_PORT", "6333"))
)

encoder = SentenceTransformer("all-MiniLM-L6-v2")
VECTOR_SIZE = 384

class VectorService:
    def __init__(self):
        self.collections = {
            "chat_cache": "semantic-chat-cache",
            "documents": "document-embeddings",
            "conversations": "conversation-history"
        }
    
    async def ensure_collections(self):
        """Create collections if they don't exist"""
        for collection in self.collections.values():
            collections = await qdrant_client.get_collections()
            if collection not in [c.name for c in collections.collections]:
                await qdrant_client.create_collection(
                    collection_name=collection,
                    vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE)
                )
    
    async def store_chat_response(self, query: str, response: Dict, user_id: str):
        """Store chat response for semantic caching"""
        with tracer.start_as_current_span("store_chat_vector"):
            embedding = encoder.encode(query).tolist()
            
            await qdrant_client.upsert(
                collection_name=self.collections["chat_cache"],
                points=[PointStruct(
                    id=str(uuid.uuid4()),
                    vector=embedding,
                    payload={
                        "query": query,
                        "response": response,
                        "user_id": user_id,
                        "timestamp": np.datetime64('now').astype('int64').item()
                    }
                )]
            )
    
    async def search_similar_chats(self, query: str, user_id: str, threshold: float = 0.85):
        """Find semantically similar cached responses"""
        with tracer.start_as_current_span("search_chat_vectors") as span:
            embedding = encoder.encode(query).tolist()
            
            results = await qdrant_client.search(
                collection_name=self.collections["chat_cache"],
                query_vector=embedding,
                limit=5,
                score_threshold=threshold,
                query_filter={
                    "must": [{"key": "user_id", "match": {"value": user_id}}]
                }
            )
            
            span.set_attributes({
                "vector.results": len(results),
                "vector.threshold": threshold
            })
            
            return [r.payload for r in results if r.score >= threshold]
    
    async def store_conversation(self, conversation_id: str, messages: List[Dict], user_id: str):
        """Store conversation for context retrieval"""
        with tracer.start_as_current_span("store_conversation_vector"):
            # Create embedding from conversation context
            context = " ".join([msg["content"] for msg in messages[-5:]])  # Last 5 messages
            embedding = encoder.encode(context).tolist()
            
            await qdrant_client.upsert(
                collection_name=self.collections["conversations"],
                points=[PointStruct(
                    id=conversation_id,
                    vector=embedding,
                    payload={
                        "conversation_id": conversation_id,
                        "messages": messages,
                        "user_id": user_id,
                        "message_count": len(messages)
                    }
                )]
            )

vector_service = VectorService()

@app.on_event("startup")
async def startup():
    await vector_service.ensure_collections()

@app.post("/cache/store")
async def store_cache(query: str, response: Dict, user_id: str):
    """Store response in semantic cache"""
    await vector_service.store_chat_response(query, response, user_id)
    return {"status": "stored"}

@app.get("/cache/search")
async def search_cache(query: str, user_id: str, threshold: float = 0.85):
    """Search semantic cache"""
    results = await vector_service.search_similar_chats(query, user_id, threshold)
    return {"results": results, "count": len(results)}

@app.post("/conversations/store")
async def store_conversation(conversation_id: str, messages: List[Dict], user_id: str):
    """Store conversation context"""
    await vector_service.store_conversation(conversation_id, messages, user_id)
    return {"status": "stored"}

@app.get("/conversations/similar")
async def find_similar_conversations(query: str, user_id: str, limit: int = 3):
    """Find similar conversations for context"""
    embedding = encoder.encode(query).tolist()
    
    results = await qdrant_client.search(
        collection_name=vector_service.collections["conversations"],
        query_vector=embedding,
        limit=limit,
        query_filter={
            "must": [{"key": "user_id", "match": {"value": user_id}}]
        }
    )
    
    return {"conversations": [r.payload for r in results]}

@app.get("/health")
async def health_check():
    """Health check"""
    try:
        collections = await qdrant_client.get_collections()
        return {
            "status": "healthy",
            "service": "vector-db",
            "collections": len(collections.collections)
        }
    except Exception:
        return {"status": "unhealthy", "service": "vector-db"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)