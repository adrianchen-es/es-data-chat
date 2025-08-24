# ai-service/src/main.py
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic_ai import Agent, RunContext
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, AsyncGenerator
import httpx
import asyncio
import uuid
from datetime import datetime
import os
import json
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

app = FastAPI(title="Enhanced AI Service", version="2.1.0")
FastAPIInstrumentor.instrument_app(app)
tracer = trace.get_tracer(__name__)

# Service URLs
VECTOR_SERVICE_URL = os.getenv("VECTOR_SERVICE_URL", "http://vector-service:8004")
ES_SERVICE_URL = os.getenv("ELASTICSEARCH_SERVICE_URL", "http://document-service:8001")

# Multi-model configuration with Azure OpenAI
MODELS = {
    "gpt-4o": OpenAIModel("gpt-4o", api_key=os.getenv("OPENAI_API_KEY")),
    "gpt-3.5-turbo": OpenAIModel("gpt-3.5-turbo", api_key=os.getenv("OPENAI_API_KEY")),
    "claude-3-sonnet": AnthropicModel("claude-3-5-sonnet-20241022", api_key=os.getenv("ANTHROPIC_API_KEY")),
    "azure-gpt-4": OpenAIModel(
        "gpt-4",
        api_key=os.getenv("AZURE_OPENAI_API_KEY"),
        base_url=f"{os.getenv('AZURE_OPENAI_ENDPOINT')}/openai/deployments/{os.getenv('AZURE_DEPLOYMENT_NAME', 'gpt-4')}/",
        api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
    ) if os.getenv("AZURE_OPENAI_API_KEY") else None,
    "azure-gpt-35": OpenAIModel(
        "gpt-3.5-turbo", 
        api_key=os.getenv("AZURE_OPENAI_API_KEY"),
        base_url=f"{os.getenv('AZURE_OPENAI_ENDPOINT')}/openai/deployments/{os.getenv('AZURE_DEPLOYMENT_NAME_35', 'gpt-35-turbo')}/",
        api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
    ) if os.getenv("AZURE_OPENAI_API_KEY") else None
}

# Filter out None models
MODELS = {k: v for k, v in MODELS.items() if v is not None}

# Request/Response models
class ChatRequest(BaseModel):
    message: str = Field(max_length=2000)
    conversation_id: Optional[str] = None
    user_id: str
    model_preference: str = "gpt-4o"
    use_rag: bool = True
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=2000, ge=1, le=4000)

class ChatResponse(BaseModel):
    response: str
    conversation_id: str
    model_used: str
    confidence: float
    sources: List[str] = []
    processing_time_ms: int
    cached: bool = False
    token_count: Optional[int] = None

class ConversationManager:
    def __init__(self):
        self.conversations: Dict[str, List[Dict]] = {}
        self.http_client = httpx.AsyncClient(timeout=30.0)
    
    async def get_conversation_history(self, conversation_id: str, limit: int = 10) -> List[Dict]:
        """Retrieve conversation history"""
        try:
            response = await self.http_client.get(
                f"{VECTOR_SERVICE_URL}/conversations/similar",
                params={"query": conversation_id, "user_id": "system", "limit": 1}
            )
            if response.status_code == 200:
                data = response.json()
                if data["conversations"]:
                    return data["conversations"][0]["messages"][-limit:]
        except Exception:
            pass
        return []
    
    async def store_conversation(self, conversation_id: str, messages: List[Dict], user_id: str):
        """Store conversation in vector database"""
        try:
            await self.http_client.post(
                f"{VECTOR_SERVICE_URL}/conversations/store",
                json={
                    "conversation_id": conversation_id,
                    "messages": messages,
                    "user_id": user_id
                }
            )
        except Exception:
            pass

class ModelRouter:
    def __init__(self):
        self.model_health = {name: True for name in MODELS.keys()}
        self.model_costs = {
            "gpt-4o": {"input": 0.005, "output": 0.015},
            "gpt-3.5-turbo": {"input": 0.001, "output": 0.002},
            "claude-3-sonnet": {"input": 0.003, "output": 0.015},
            "azure-gpt-4": {"input": 0.03, "output": 0.06},
            "azure-gpt-35": {"input": 0.002, "output": 0.002}
        }
        self.fallback_chain = [
            "gpt-4o", "azure-gpt-4", "claude-3-sonnet", 
            "gpt-3.5-turbo", "azure-gpt-35"
        ]
    
    def get_model(self, preference: str) -> tuple[Model, str]:
        """Get model with fallback logic, return model and actual name used"""
        if preference in MODELS and self.model_health.get(preference, False):
            return MODELS[preference], preference
        
        # Fallback to healthy models
        for model_name in self.fallback_chain:
            if model_name in MODELS and self.model_health.get(model_name, False):
                return MODELS[model_name], model_name
        
        raise HTTPException(status_code=503, detail="No healthy models available")
    
    async def update_model_health(self):
        """Check model health periodically"""
        for name, model in MODELS.items():
            try:
                # Test with minimal request
                test_response = await asyncio.wait_for(
                    model.generate("Hi", max_tokens=1),
                    timeout=10.0
                )
                self.model_health[name] = True
            except Exception as e:
                self.model_health[name] = False
                print(f"Model {name} unhealthy: {e}")

class Dependencies:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.http_client = httpx.AsyncClient(timeout=30.0)
        self.conversation_manager = ConversationManager()
    
    async def search_documents(self, query: str, rerank: bool = True) -> str:
        """Enhanced RAG with re-ranking"""
        with tracer.start_as_current_span("rag_search") as span:
            try:
                response = await self.http_client.get(
                    f"{ES_SERVICE_URL}/search",
                    params={
                        "query": query,
                        "size": 10,
                        "user_id": self.user_id
                    }
                )
                
                if response.status_code == 200:
                    results = response.json()
                    
                    if rerank and results.get("hits"):
                        # Re-ranking with relevance + recency + user context
                        ranked_results = sorted(
                            results["hits"],
                            key=lambda x: (
                                x["score"] * 0.7 + 
                                (1.0 if "recent" in x.get("metadata", {}) else 0.3) +
                                (0.2 if x.get("user_id") == self.user_id else 0)
                            ),
                            reverse=True
                        )[:5]
                    else:
                        ranked_results = results.get("hits", [])[:5]
                    
                    context = "\n\n".join([
                        f"Source: {r['filename']}\n{r['content'][:500]}..."
                        for r in ranked_results
                    ])
                    
                    span.set_attributes({
                        "rag.results": len(ranked_results),
                        "rag.reranked": rerank
                    })
                    
                    return context or "No relevant documents found."
                
            except Exception as e:
                span.record_exception(e)
                return "Search service unavailable."
    
    async def get_conversation_context(self, conversation_id: str) -> str:
        """Get relevant conversation context"""
        history = await self.conversation_manager.get_conversation_history(conversation_id)
        if history:
            return "Previous conversation:\n" + "\n".join([
                f"{'User' if msg['role'] == 'user' else 'AI'}: {msg['content'][:100]}..."
                for msg in history[-3:]
            ])
        return ""

# Initialize services
conversation_manager = ConversationManager()
model_router = ModelRouter()

# Create agents for different models
agents = {}
for model_name, model in MODELS.items():
    agent = Agent(
        model,
        deps_type=Dependencies,
        result_type=str,
        system_prompt=f"""You are an intelligent AI assistant ({model_name}) with access to a knowledge base and conversation history. 
        Provide accurate, helpful responses using available context. Cite sources when using retrieved information.
        Be concise but comprehensive in your responses."""
    )
    
    @agent.tool
    async def search_knowledge_base(ctx: RunContext[Dependencies], query: str) -> str:
        """Search the knowledge base for relevant information."""
        return await ctx.deps.search_documents(query, rerank=True)
    
    @agent.tool
    async def get_context(ctx: RunContext[Dependencies], conversation_id: str) -> str:
        """Get conversation context for continuity."""
        return await ctx.deps.get_conversation_context(conversation_id)
    
    agents[model_name] = agent

@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest, background_tasks: BackgroundTasks):
    """Enhanced chat with Azure OpenAI support"""
    with tracer.start_as_current_span("ai_chat") as span:
        import time
        start_time = time.time()
        
        conversation_id = request.conversation_id or str(uuid.uuid4())
        
        # Check semantic cache first
        cached_response = await check_semantic_cache(request.message, request.user_id)
        if cached_response:
            return ChatResponse(
                response=cached_response["response"],
                conversation_id=conversation_id,
                model_used=cached_response.get("model_used", "cached"),
                confidence=cached_response.get("confidence", 0.9),
                sources=cached_response.get("sources", []),
                processing_time_ms=int((time.time() - start_time) * 1000),
                cached=True
            )
        
        try:
            # Get model with fallback
            model, actual_model_name = model_router.get_model(request.model_preference)
            agent = agents[actual_model_name]
            
            # Create dependencies
            deps = Dependencies(request.user_id)
            
            # Generate response with custom parameters
            result = await agent.run(
                request.message, 
                deps=deps,
                max_tokens=request.max_tokens,
                temperature=request.temperature
            )
            
            processing_time = int((time.time() - start_time) * 1000)
            
            response = ChatResponse(
                response=result.data,
                conversation_id=conversation_id,
                model_used=actual_model_name,
                confidence=0.85,
                sources=["doc1.pdf", "doc2.docx"],  # Extract from tools in production
                processing_time_ms=processing_time,
                cached=False,
                token_count=len(result.data.split()) * 1.3  # Rough estimate
            )
            
            # Store in caches asynchronously
            background_tasks.add_task(
                store_response_cache,
                request.message,
                response.dict(),
                request.user_id
            )
            
            span.set_attributes({
                "ai.model_requested": request.model_preference,
                "ai.model_used": actual_model_name,
                "ai.conversation_id": conversation_id,
                "ai.processing_time": processing_time,
                "ai.token_count": response.token_count
            })
            
            return response
            
        except Exception as e:
            span.record_exception(e)
            raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")

@app.get("/stream")
async def stream_chat(
    message: str, 
    user_id: str, 
    conversation_id: Optional[str] = None, 
    model_preference: str = "gpt-4o",
    temperature: float = 0.7
):
    """Stream chat response with token-level optimization"""
    async def generate():
        try:
            conversation_id_final = conversation_id or str(uuid.uuid4())
            model, actual_model_name = model_router.get_model(model_preference)
            agent = agents[actual_model_name]
            deps = Dependencies(user_id)
            
            buffer = ""
            token_count = 0
            
            async for chunk in agent.run_stream(
                message, 
                deps=deps,
                temperature=temperature
            ):
                if hasattr(chunk, 'data'):
                    # Token-level streaming with intelligent buffering
                    buffer += chunk.data
                    token_count += 1
                    
                    # Stream on punctuation, whitespace, or buffer size
                    should_stream = (
                        len(buffer) >= 15 or 
                        chunk.data.endswith(('.', '!', '?', '\n', ',')) or
                        token_count % 5 == 0
                    )
                    
                    if should_stream:
                        yield f"data: {json.dumps({
                            'content': buffer, 
                            'finished': False,
                            'model_used': actual_model_name,
                            'token_count': token_count
                        })}\n\n"
                        buffer = ""
                        await asyncio.sleep(0.01)  # Smooth streaming
            
            if buffer:
                yield f"data: {json.dumps({'content': buffer, 'finished': False})}\n\n"
            
            yield f"data: {json.dumps({
                'finished': True, 
                'conversation_id': conversation_id_final,
                'model_used': actual_model_name,
                'total_tokens': token_count
            })}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e), 'finished': True})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache", 
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable nginx buffering for SSE
        }
    )

@app.get("/models")
async def get_available_models():
    """Get available models and their health status"""
    await model_router.update_model_health()
    return {
        "models": [
            {
                "name": name,
                "healthy": model_router.model_health.get(name, False),
                "costs": model_router.model_costs.get(name, {}),
                "provider": "azure" if name.startswith("azure") else name.split("-")[0] if "-" in name else "openai"
            }
            for name in MODELS.keys()
        ],
        "fallback_chain": model_router.fallback_chain
    }

async def check_semantic_cache(query: str, user_id: str) -> Optional[Dict]:
    """Check vector-based semantic cache"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{VECTOR_SERVICE_URL}/cache/search",
                params={"query": query, "user_id": user_id, "threshold": 0.85}
            )
            if response.status_code == 200:
                results = response.json()["results"]
                return results[0] if results else None
    except Exception:
        return None

async def store_response_cache(query: str, response: Dict, user_id: str):
    """Store response in semantic cache"""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{VECTOR_SERVICE_URL}/cache/store",
                params={"query": query, "user_id": user_id},
                json=response
            )
    except Exception:
        pass

@app.get("/conversations")
async def get_conversations(user_id: str):
    """Get user's conversations"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{VECTOR_SERVICE_URL}/conversations/similar",
                params={"query": "", "user_id": user_id, "limit": 20}
            )
            if response.status_code == 200:
                return response.json()
    except Exception:
        pass
    return {"conversations": []}

@app.get("/health")
async def health_check():
    """Enhanced health check with model status"""
    await model_router.update_model_health()
    healthy_models = sum(model_router.model_health.values())
    
    return {
        "status": "healthy" if healthy_models > 0 else "degraded",
        "service": "ai-service",
        "models": model_router.model_health,
        "active_models": healthy_models,
        "total_models": len(MODELS),
        "azure_configured": any(name.startswith("azure") for name in MODELS.keys())
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)