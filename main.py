import os
import json
import logging
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import httpx
from elasticsearch import AsyncElasticsearch
from openai import AsyncAzureOpenAI

# OpenTelemetry imports
from opentelemetry import trace, metrics
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.elasticsearch import ElasticsearchInstrumentor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize OpenTelemetry
def setup_telemetry():
    # Configure tracing
    trace_exporter = OTLPSpanExporter(
        endpoint=os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://localhost:4317"),
        insecure=True
    )
    trace.set_tracer_provider(TracerProvider())
    tracer = trace.get_tracer(__name__)
    trace.get_tracer_provider().add_span_processor(
        BatchSpanProcessor(trace_exporter)
    )
    
    # Configure metrics
    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(
            endpoint=os.getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "http://localhost:4317"),
            insecure=True
        ),
        export_interval_millis=5000,
    )
    metrics.set_meter_provider(MeterProvider(metric_readers=[metric_reader]))
    meter = metrics.get_meter(__name__)
    
    return tracer, meter

tracer, meter = setup_telemetry()

# Metrics
query_counter = meter.create_counter(
    "elasticsearch_queries_total",
    description="Total number of Elasticsearch queries"
)
llm_requests_counter = meter.create_counter(
    "llm_requests_total", 
    description="Total number of LLM requests"
)

# Pydantic models
class ChatMessage(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    index_name: str = Field(..., min_length=1, max_length=100)

class ChatResponse(BaseModel):
    response: str
    elasticsearch_query: Dict[str, Any]
    results_count: int
    raw_results: List[Dict[str, Any]]

class HealthResponse(BaseModel):
    status: str
    elasticsearch: str
    llm_provider: str

# Configuration
class Config:
    def __init__(self):
        # Elasticsearch configuration
        self.es_host = os.getenv("ELASTICSEARCH_HOST", "localhost:9200")
        self.es_api_key = os.getenv("ELASTICSEARCH_API_KEY")
        if not self.es_api_key:
            raise ValueError("ELASTICSEARCH_API_KEY environment variable is required")
        
        # LLM Provider configuration
        self.llm_provider = os.getenv("LLM_PROVIDER", "azure").lower()
        
        if self.llm_provider == "azure":
            self.azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
            self.azure_api_key = os.getenv("AZURE_OPENAI_API_KEY")
            self.azure_deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4")
            self.azure_api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
            
            if not all([self.azure_endpoint, self.azure_api_key]):
                raise ValueError("Azure OpenAI credentials are required when using Azure provider")
        
        elif self.llm_provider == "openai":
            self.openai_api_key = os.getenv("OPENAI_API_KEY")
            self.openai_model = os.getenv("OPENAI_MODEL", "gpt-4")
            
            if not self.openai_api_key:
                raise ValueError("OPENAI_API_KEY is required when using OpenAI provider")

config = Config()

# Global clients
es_client: Optional[AsyncElasticsearch] = None
llm_client: Optional[AsyncAzureOpenAI] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global es_client, llm_client
    
    # Initialize Elasticsearch client
    es_client = AsyncElasticsearch(
        hosts=[f"http://{config.es_host}"],
        api_key=config.es_api_key,
        verify_certs=False
    )
    
    # Initialize LLM client
    if config.llm_provider == "azure":
        llm_client = AsyncAzureOpenAI(
            azure_endpoint=config.azure_endpoint,
            api_key=config.azure_api_key,
            api_version=config.azure_api_version
        )
    
    logger.info(f"Application started with {config.llm_provider} LLM provider")
    yield
    
    # Cleanup
    if es_client:
        await es_client.close()

# Initialize FastAPI app
app = FastAPI(
    title="Elasticsearch AI Chat API",
    description="AI-powered chat interface for Elasticsearch queries",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instrument FastAPI with OpenTelemetry
FastAPIInstrumentor.instrument_app(app)
HTTPXClientInstrumentor().instrument()
ElasticsearchInstrumentor().instrument()

# Dependency to get ES client
async def get_es_client() -> AsyncElasticsearch:
    if not es_client:
        raise HTTPException(status_code=500, detail="Elasticsearch client not initialized")
    return es_client

# Dependency to get LLM client
async def get_llm_client():
    if not llm_client:
        raise HTTPException(status_code=500, detail="LLM client not initialized")
    return llm_client

# System prompt for LLM
SYSTEM_PROMPT = """You are an Elasticsearch query generator. Given a user's natural language query and information about the Elasticsearch index structure, generate an appropriate Elasticsearch query in JSON format.

Rules:
1. Return ONLY valid Elasticsearch JSON query - no explanations or markdown
2. Use appropriate query types (match, term, range, bool, etc.)
3. Consider relevance scoring and filtering
4. Limit results to reasonable numbers (default 10, max 100)
5. Use aggregations when appropriate for analytical queries
6. Handle date ranges, numeric ranges, and text searches appropriately

Index structure will be provided in the user message. Generate queries that make sense for the data structure described.

Example query structure:
{
  "query": {
    "bool": {
      "must": [
        {"match": {"field": "value"}}
      ]
    }
  },
  "size": 10,
  "sort": [{"timestamp": {"order": "desc"}}]
}"""

async def get_index_mapping(es: AsyncElasticsearch, index_name: str) -> Dict[str, Any]:
    """Get the mapping for an Elasticsearch index"""
    try:
        mapping = await es.indices.get_mapping(index=index_name)
        return mapping[index_name]["mappings"]["properties"]
    except Exception as e:
        logger.error(f"Error getting mapping for index {index_name}: {e}")
        return {}

async def generate_elasticsearch_query(user_query: str, index_name: str, index_mapping: Dict[str, Any]) -> Dict[str, Any]:
    """Generate Elasticsearch query using LLM"""
    with tracer.start_as_current_span("generate_elasticsearch_query") as span:
        span.set_attribute("user_query", user_query)
        span.set_attribute("index_name", index_name)
        
        mapping_info = json.dumps(index_mapping, indent=2)
        
        user_prompt = f"""
Index: {index_name}
Field mappings: {mapping_info}

User query: {user_query}

Generate an Elasticsearch query for this request.
"""
        
        try:
            if config.llm_provider == "azure":
                response = await llm_client.chat.completions.create(
                    model=config.azure_deployment,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt}
                    ],
                    max_tokens=1000,
                    temperature=0.1
                )
                query_text = response.choices[0].message.content.strip()
                
            elif config.llm_provider == "openai":
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {config.openai_api_key}"},
                        json={
                            "model": config.openai_model,
                            "messages": [
                                {"role": "system", "content": SYSTEM_PROMPT},
                                {"role": "user", "content": user_prompt}
                            ],
                            "max_tokens": 1000,
                            "temperature": 0.1
                        }
                    )
                    response.raise_for_status()
                    data = response.json()
                    query_text = data["choices"][0]["message"]["content"].strip()
            
            # Clean up response (remove markdown if present)
            if query_text.startswith("```json"):
                query_text = query_text.split("```json")[1].split("```")[0].strip()
            elif query_text.startswith("```"):
                query_text = query_text.split("```")[1].split("```")[0].strip()
            
            es_query = json.loads(query_text)
            llm_requests_counter.add(1, {"provider": config.llm_provider})
            
            return es_query
            
        except Exception as e:
            logger.error(f"Error generating query: {e}")
            span.record_exception(e)
            raise HTTPException(status_code=500, detail=f"Error generating query: {str(e)}")

@app.get("/", response_class=FileResponse)
async def serve_frontend():
    return FileResponse("static/index.html")

@app.get("/health", response_model=HealthResponse)
async def health_check(es: AsyncElasticsearch = Depends(get_es_client)):
    """Health check endpoint"""
    try:
        es_health = await es.cluster.health()
        es_status = "healthy" if es_health["status"] in ["green", "yellow"] else "unhealthy"
    except Exception:
        es_status = "unhealthy"
    
    return HealthResponse(
        status="healthy" if es_status == "healthy" else "degraded",
        elasticsearch=es_status,
        llm_provider=config.llm_provider
    )

@app.post("/api/chat", response_model=ChatResponse)
async def chat(
    request: ChatMessage,
    es: AsyncElasticsearch = Depends(get_es_client),
    llm: AsyncAzureOpenAI = Depends(get_llm_client)
):
    """Main chat endpoint"""
    with tracer.start_as_current_span("chat_request") as span:
        span.set_attribute("user_message", request.message)
        span.set_attribute("index_name", request.index_name)
        
        try:
            # Get index mapping
            index_mapping = await get_index_mapping(es, request.index_name)
            
            # Generate Elasticsearch query
            es_query = await generate_elasticsearch_query(
                request.message, 
                request.index_name, 
                index_mapping
            )
            
            # Execute Elasticsearch query
            search_response = await es.search(
                index=request.index_name,
                body=es_query
            )
            
            query_counter.add(1, {"index": request.index_name})
            
            # Extract results
            hits = search_response["hits"]["hits"]
            total_count = search_response["hits"]["total"]["value"]
            
            # Format response
            response_text = f"Found {total_count} results matching your query."
            if hits:
                response_text += "\n\nTop results:\n"
                for i, hit in enumerate(hits[:5], 1):
                    source = hit["_source"]
                    response_text += f"{i}. "
                    # Show key fields from the document
                    key_fields = list(source.keys())[:3]  # Show first 3 fields
                    for field in key_fields:
                        response_text += f"{field}: {source[field]} | "
                    response_text = response_text.rstrip(" | ") + "\n"
            
            return ChatResponse(
                response=response_text,
                elasticsearch_query=es_query,
                results_count=total_count,
                raw_results=[hit["_source"] for hit in hits]
            )
            
        except Exception as e:
            logger.error(f"Error in chat request: {e}")
            span.record_exception(e)
            raise HTTPException(status_code=500, detail=str(e))

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        access_log=True
    )
