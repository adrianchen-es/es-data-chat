# ai-service/src/main.py
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic_ai import Agent, RunContext
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.providers.azure import AzureProvider
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

# Multi-model configuration with conditional initialization
MODELS = {}

# Only add models if we have the required API keys
if os.getenv("OPENAI_API_KEY"):
    MODELS["gpt-4o"] = OpenAIChatModel("gpt-4o")
    MODELS["gpt-3.5-turbo"] = OpenAIChatModel("gpt-3.5-turbo")

if os.getenv("ANTHROPIC_API_KEY"):
    MODELS["claude-3-sonnet"] = AnthropicModel("claude-3-5-sonnet-20241022")

if os.getenv("AZURE_OPENAI_API_KEY"):
    # Azure OpenAI configuration - simple approach
    azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    azure_deployment = os.getenv("AZURE_DEPLOYMENT_NAME", "azure-gpt-4o-deployment")
    azure_api_key = os.getenv("AZURE_OPENAI_API_KEY")
    azure_api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
    
    print(f"🔧 Configuring Azure OpenAI models")
    print(f"   Endpoint: {azure_endpoint}")
    print(f"   API Version: {azure_api_version}")
    print(f"   API Key: {azure_api_key[:8]}...{azure_api_key[-4:]}")

    azure_provider=AzureProvider(
        azure_endpoint=azure_endpoint,
        api_version=azure_api_version,
        api_key=azure_api_key,
    )
    
    try:
        # Use actual Azure deployment names from environment
        azure_deployment_35 = os.getenv("AZURE_DEPLOYMENT_NAME_35")
        
        if azure_deployment:
            MODELS[azure_deployment] = OpenAIChatModel(azure_deployment, provider=azure_provider)
            # Add user-friendly aliases that map to actual deployments
            MODELS["azure-gpt-4"] = OpenAIChatModel(azure_deployment, provider=azure_provider)
        if azure_deployment_35:
            MODELS[azure_deployment_35] = OpenAIChatModel(azure_deployment_35, provider=azure_provider)
            # Add user-friendly aliases that map to actual deployments
            MODELS["azure-gpt-35-turbo"] = OpenAIChatModel(azure_deployment_35, provider=azure_provider)
        

        print(f"✅ Successfully configured {len(MODELS)} Azure OpenAI models")
        
    except Exception as e:
        try:
            # Fallback: use actual deployment names without provider
            azure_deployment_35 = os.getenv("AZURE_DEPLOYMENT_NAME_35", "gpt-35-turbo")
            
            if azure_deployment:
                MODELS[azure_deployment] = OpenAIChatModel(azure_deployment)
                # Add user-friendly aliases
                MODELS["azure-gpt-4"] = OpenAIChatModel(azure_deployment)
            if azure_deployment_35:
                MODELS[azure_deployment_35] = OpenAIChatModel(azure_deployment_35)
                # Add user-friendly aliases
                MODELS["azure-gpt-35-turbo"] = OpenAIChatModel(azure_deployment_35)

            print(f"✅ Successfully configured {len(MODELS)} Azure OpenAI models with default config.")
            
        except Exception as e:
            print(f"❌ Failed to configure Azure OpenAI: {e}")

# Ensure we have at least one model
if not MODELS:
    print("Warning: No AI provider API keys found. Service will run in limited mode.")
    raise RuntimeError("No AI models available. Please set AZURE_OPENAI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY environment variables.")

# Request/Response models
class ChatRequest(BaseModel):
    message: str = Field(max_length=2000)
    conversation_id: Optional[str] = None
    user_id: str
    model_preference: str = Field(default="elastic-on-gpt4-32k")
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
    token_count: int = Field(default=0)
    
    @classmethod
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
    
    def __init__(self, **data):
        # Ensure token_count is always an integer
        if 'token_count' in data and isinstance(data['token_count'], float):
            data['token_count'] = int(round(data['token_count']))
        super().__init__(**data)

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
            "azure-gpt-35-turbo": {"input": 0.002, "output": 0.002},
            "gpt-35-turbo": {"input": 0.002, "output": 0.002}
        }
        # Create fallback chain with available Azure deployment having highest precedence
        available_models = list(MODELS.keys())
        azure_deployment = os.getenv("AZURE_DEPLOYMENT_NAME")
        
        # Prioritize the actual available Azure deployment first
        self.fallback_chain = []
        if azure_deployment and azure_deployment in available_models:
            self.fallback_chain.append(azure_deployment)
        
        # Add other models in preference order, skipping the main deployment
        preference_order = [
            "azure-gpt-4", "azure-gpt-35-turbo", "gpt-4o", 
            "gpt-3.5-turbo", "claude-3-sonnet"
        ]
        for model in preference_order:
            if model in available_models and model != azure_deployment:
                self.fallback_chain.append(model)
        
        # Add any remaining models not in preference order
        self.fallback_chain.extend([model for model in available_models if model not in self.fallback_chain])
    
    def get_model(self, preference: str) -> tuple[Model, str]:
        """Get model with fallback logic, return model and actual name used"""
        if preference in MODELS and self.model_health.get(preference, False):
            return MODELS[preference], preference
        
        # Fallback to healthy models
        for model_name in self.fallback_chain:
            if model_name in MODELS and self.model_health.get(model_name, False):
                return MODELS[model_name], model_name
        
        # If no healthy models, try the preferred model anyway (for testing)
        if preference in MODELS:
            print(f"Warning: Using potentially unhealthy model {preference}")
            return MODELS[preference], preference
            
        # Try any available model as last resort
        if MODELS:
            model_name = next(iter(MODELS.keys()))
            print(f"Warning: Using potentially unhealthy fallback model {model_name}")
            return MODELS[model_name], model_name
        
        raise HTTPException(status_code=503, detail="No healthy models available")
    
    async def update_model_health(self):
        """Check model health periodically"""
        for name, model in MODELS.items():
            try:
                # Create a simple agent for health check
                health_agent = Agent(
                    model,
                    output_type=str,
                    system_prompt="You are a health check agent. Respond briefly."
                )
                
                # Test with minimal request
                test_response = await asyncio.wait_for(
                    health_agent.run("Hi"),
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
    # Avoid very long inline f-strings which can be sensitive to accidental
    # line breaks when files are edited or copied. Build the prompt safely.
    system_prompt = (
        "You are an intelligent AI assistant ({model_name}) with access to a knowledge base and conversation history. "
        "Provide accurate, helpful responses using available context. Cite sources when using retrieved information. "
        "Be concise but comprehensive in your responses."
    ).format(model_name=model_name)

    agent = Agent(
        model,
        deps_type=Dependencies,
        output_type=str,
        system_prompt=system_prompt
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
        
        print(f"🔧 Chat request received: {request.message}")
        print(f"🔧 Model preference: {request.model_preference}")
        
        conversation_id = request.conversation_id or str(uuid.uuid4())
        
        # Check semantic cache first
        try:
            cached_response = await check_semantic_cache(request.message, request.user_id)
            if cached_response:
                return ChatResponse(
                    response=cached_response["response"],
                    conversation_id=conversation_id,
                    model_used=cached_response.get("model_used", "cached"),
                    confidence=cached_response.get("confidence", 0.9),
                    sources=cached_response.get("sources", []),
                    processing_time_ms=int((time.time() - start_time) * 1000),
                    cached=True,
                    token_count=int(cached_response.get("token_count", 20))  # Ensure integer
                )
        except Exception as e:
            print(f"⚠️ Cache check failed: {e}")
        
        try:
            # Get model with fallback
            print(f"🔧 Getting model for preference: {request.model_preference}")
            model, actual_model_name = model_router.get_model(request.model_preference)
            print(f"🔧 Using model: {actual_model_name}")
            
            # Check if we should use mock mode due to configuration issues
            if not model_router.model_health.get(actual_model_name, False):
                print(f"⚠️ Model {actual_model_name} is unhealthy, using mock response")
                processing_time = int((time.time() - start_time) * 1000)
                return ChatResponse(
                    response=f"This is a mock response to your message: '{request.message}'. The AI service is currently in development mode as the Azure OpenAI models are not available. Your document was uploaded successfully earlier and the RAG system is working.",
                    conversation_id=conversation_id,
                    model_used=f"{actual_model_name} (mock)",
                    confidence=0.5,
                    sources=["mock-response"],
                    processing_time_ms=processing_time,
                    cached=False,
                    token_count=25
                )
            
            agent = agents[actual_model_name]
            print(f"🔧 Agent retrieved successfully")
            
            # Create dependencies
            deps = Dependencies(request.user_id)
            print(f"🔧 Dependencies created")
            
            # Generate response with custom parameters
            print(f"🔧 Starting agent.run()...")
            result = await agent.run(
                request.message, 
                deps=deps
                # Note: max_tokens and temperature are handled by the model configuration
            )
            print(f"🔧 Agent.run() completed")
            
                        # Debug: print result attributes to understand structure
            print(f"Result type: {type(result)}")
            print(f"Result has usage: {hasattr(result, 'usage')}")
            if hasattr(result, 'usage'):
                print(f"Usage info: {result.usage}")
                if hasattr(result.usage, 'total_tokens'):
                    print(f"Usage total_tokens: {result.usage.total_tokens} (type: {type(result.usage.total_tokens)})")
            print(f"Result attributes: {dir(result)}")
            
            # Try different ways to access the response
            response_text = ""
            if hasattr(result, 'output'):
                response_text = str(result.output)
                print(f"🔧 Used result.output: {response_text[:100]}...")
            elif hasattr(result, 'data'):
                response_text = str(result.data)
                print(f"🔧 Used result.data: {response_text[:100]}...")
            elif hasattr(result, 'content'):
                response_text = str(result.content)
                print(f"🔧 Used result.content: {response_text[:100]}...")
            elif hasattr(result, 'text'):
                response_text = str(result.text)
                print(f"🔧 Used result.text: {response_text[:100]}...")
            elif hasattr(result, 'response'):
                response_text = str(result.response)
                print(f"🔧 Used result.response: {response_text[:100]}...")
            elif hasattr(result, 'value'):
                response_text = str(result.value)
                print(f"🔧 Used result.value: {response_text[:100]}...")
            else:
                # Try to extract from the result object
                response_text = str(result)
                print(f"🔧 Used str(result): {response_text[:100]}...")
                # If it's a complex object, try to get its content
                if hasattr(result, '__dict__'):
                    attrs = vars(result)
                    print(f"🔧 Result object attributes: {list(attrs.keys())}")
                    # Look for common response attribute names
                    for attr_name in ['output', 'data', 'content', 'text', 'response', 'value', 'message']:
                        if attr_name in attrs:
                            response_text = str(attrs[attr_name])
                            print(f"🔧 Found response in attribute '{attr_name}': {response_text[:100]}...")
                            break
            
            print(f"🔧 Response text extracted: {response_text[:100]}...")
            print(f"🔧 Response text length: {len(response_text.split())}")
            
            # Get token count from agent usage if available, otherwise calculate
            calculated_tokens = 1  # Default minimum
            if hasattr(result, 'usage') and hasattr(result.usage, 'total_tokens'):
                # Use actual token count from the API if available
                calculated_tokens = int(result.usage.total_tokens)
                print(f"🔧 Using API token count: {calculated_tokens}")
            else:
                # Fallback to word count estimation
                word_count = len(response_text.split())
                calculated_tokens = int(max(1, word_count))  # Explicitly cast to int
                print(f"🔧 Using estimated token count: {calculated_tokens}")
            
            print(f"🔧 Final token count: {calculated_tokens} (type: {type(calculated_tokens)})")
            
            processing_time = int((time.time() - start_time) * 1000)
            
            response = ChatResponse(
                response=response_text,
                conversation_id=conversation_id,
                model_used=actual_model_name,
                confidence=0.85,
                sources=["doc1.pdf", "doc2.docx"],  # Extract from tools in production
                processing_time_ms=processing_time,
                cached=False,
                token_count=calculated_tokens
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
            print(f"❌ Error in chat endpoint: {str(e)}")
            import traceback
            print(f"❌ Traceback: {traceback.format_exc()}")
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
                        payload = {
                            'content': buffer,
                            'finished': False,
                            'model_used': actual_model_name,
                            'token_count': token_count
                        }
                        yield "data: " + json.dumps(payload) + "\n\n"
                        buffer = ""
                        await asyncio.sleep(0.01)  # Smooth streaming
            
            if buffer:
                payload = {'content': buffer, 'finished': False}
                yield "data: " + json.dumps(payload) + "\n\n"
            
            payload = {
                'finished': True, 
                'conversation_id': conversation_id_final,
                'model_used': actual_model_name,
                'total_tokens': token_count
            }
            yield "data: " + json.dumps(payload) + "\n\n"
            
        except Exception as e:
            payload = {'error': str(e), 'finished': True}
            yield "data: " + json.dumps(payload) + "\n\n"
    
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
    # Check if running under gunicorn
    if "gunicorn" in os.environ.get("SERVER_SOFTWARE", ""):
        # Running under gunicorn, don't start uvicorn
        pass
    else:
        import uvicorn
        # Fallback to uvicorn for development
        uvicorn.run(app, host="0.0.0.0", port=8000)