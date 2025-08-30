# document-service/src/main.py
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from elasticsearch import AsyncElasticsearch
import pymupdf4llm
import magic
import hashlib
import uuid
from pathlib import Path
from typing import List, Dict, Any
import os
import asyncio
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

app = FastAPI(title="Document Processing Service", version="1.0.0")
FastAPIInstrumentor.instrument_app(app)
tracer = trace.get_tracer(__name__)

# Configuration
ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.doc', '.pptx', '.ppt'}
ALLOWED_MIME_TYPES = {
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword'
}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
UPLOAD_DIR = Path("/tmp/uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Elasticsearch client with authentication
def create_es_client():
    """Create Elasticsearch client with proper authentication"""
    config = {
        'hosts': [os.getenv('ELASTICSEARCH_URL', 'http://localhost:9200')],
        'timeout': 30,
        'max_retries': 3,
        'retry_on_timeout': True
    }
    
    # API Key authentication
    api_key = os.getenv('ELASTICSEARCH_API_KEY')
    if api_key:
        config['api_key'] = api_key
        
    # SSL verification
    verify_certs = os.getenv('ELASTICSEARCH_VERIFY_CERTS', 'true').lower() == 'true'
    if not verify_certs:
        config['verify_certs'] = False
        config['ssl_show_warn'] = False
    
    return AsyncElasticsearch(**config)

es_client = create_es_client()

class DocumentProcessor:
    @staticmethod
    def validate_file(file_path: str, content: bytes) -> str | None:
        """Validate uploaded file"""
        with tracer.start_as_current_span("file_validation") as span:
            path = Path(file_path)
            
            # Size check
            if len(content) > MAX_FILE_SIZE:
                return "File exceeds 50MB limit"
            
            # Extension check
            if path.suffix.lower() not in ALLOWED_EXTENSIONS:
                return f"Extension {path.suffix} not allowed"
            
            # MIME type check
            mime_type = magic.from_buffer(content, mime=True)
            if mime_type not in ALLOWED_MIME_TYPES:
                return f"MIME type {mime_type} not allowed"
            
            span.set_attributes({
                "file.size": len(content),
                "file.extension": path.suffix,
                "file.mime_type": mime_type
            })
            return None
    
    @staticmethod
    def process_document(file_path: str) -> Dict[str, Any]:
        """Process document with PyMuPDF4LLM"""
        with tracer.start_as_current_span("document_processing") as span:
            try:
                # Process with PyMuPDF4LLM
                md_text = pymupdf4llm.to_markdown(
                    file_path,
                    page_chunks=True,
                    write_images=True,
                    image_path=str(UPLOAD_DIR / "images"),
                    dpi=200
                )
                
                chunks = []
                page_num = 1
                
                # Split into manageable chunks
                for chunk in md_text.split('\n\n'):
                    if len(chunk.strip()) > 50:  # Skip very small chunks
                        chunks.append({
                            'content': chunk.strip(),
                            'page': page_num,
                            'word_count': len(chunk.split()),
                            'char_count': len(chunk)
                        })
                        if len(chunks) % 3 == 0:  # Approximate page breaks
                            page_num += 1
                
                result = {
                    'chunks': chunks,
                    'total_pages': page_num,
                    'total_chunks': len(chunks),
                    'processing_metadata': {
                        'file_size': Path(file_path).stat().st_size,
                        'processed_at': str(asyncio.get_event_loop().time())
                    }
                }
                
                span.set_attributes({
                    "document.pages": page_num,
                    "document.chunks": len(chunks),
                    "document.total_chars": sum(c['char_count'] for c in chunks)
                })
                
                return result
                
            except Exception as e:
                span.record_exception(e)
                raise RuntimeError(f"Processing failed: {str(e)}")

async def index_document(doc_id: str, filename: str, chunks: List[Dict]):
    """Index processed document in Elasticsearch"""
    with tracer.start_as_current_span("document_indexing") as span:
        try:
            # Create index if not exists
            index_name = "documents"
            if not await es_client.indices.exists(index=index_name):
                mapping = {
                    "mappings": {
                        "properties": {
                            "content": {"type": "text"},
                            "filename": {"type": "keyword"},
                            "doc_id": {"type": "keyword"},
                            "page": {"type": "integer"},
                            "word_count": {"type": "integer"},
                            "chunk_id": {"type": "keyword"},
                            "indexed_at": {"type": "date"}
                        }
                    }
                }
                await es_client.indices.create(index=index_name, body=mapping)
            
            # Index chunks
            for i, chunk in enumerate(chunks):
                doc_body = {
                    "content": chunk['content'],
                    "filename": filename,
                    "doc_id": doc_id,
                    "page": chunk['page'],
                    "word_count": chunk['word_count'],
                    "chunk_id": f"{doc_id}_chunk_{i}",
                    "indexed_at": "now"
                }
                
                await es_client.index(
                    index=index_name,
                    id=f"{doc_id}_chunk_{i}",
                    body=doc_body
                )
            
            await es_client.indices.refresh(index=index_name)
            
            span.set_attributes({
                "elasticsearch.index": index_name,
                "elasticsearch.chunks_indexed": len(chunks),
                "document.id": doc_id
            })
            
        except Exception as e:
            span.record_exception(e)
            raise

@app.post("/documents/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    """Upload and process document"""
    with tracer.start_as_current_span("document_upload") as span:
        if not file:
            raise HTTPException(status_code=400, detail="No file provided")
        
        # Read file content
        content = await file.read()
        
        # Validate file
        temp_path = UPLOAD_DIR / file.filename
        validation_error = DocumentProcessor.validate_file(str(temp_path), content)
        if validation_error:
            raise HTTPException(status_code=400, detail=validation_error)
        
        try:
            # Save file temporarily
            with open(temp_path, "wb") as f:
                f.write(content)
            
            # Process document
            result = DocumentProcessor.process_document(str(temp_path))
            
            # Generate document ID
            doc_id = str(uuid.uuid4())
            
            # Index document in background
            background_tasks.add_task(
                index_document,
                doc_id,
                file.filename,
                result['chunks']
            )
            
            response = {
                "status": "success",
                "document_id": doc_id,
                "filename": file.filename,
                "size": len(content),
                "pages_processed": result['total_pages'],
                "chunks_created": result['total_chunks'],
                "message": "Document processed and queued for indexing"
            }
            
            span.set_attributes({
                "document.filename": file.filename,
                "document.size": len(content),
                "document.pages": result['total_pages']
            })
            
            return response
            
        finally:
            # Cleanup temp file
            temp_path.unlink(missing_ok=True)

@app.get("/documents/{doc_id}")
async def get_document_info(doc_id: str):
    """Get document information"""
    try:
        query = {
            "query": {"term": {"doc_id": doc_id}},
            "aggs": {
                "page_count": {"cardinality": {"field": "page"}},
                "total_chunks": {"value_count": {"field": "chunk_id"}}
            }
        }
        
        response = await es_client.search(index="documents", body=query, size=1)
        
        if response['hits']['total']['value'] == 0:
            raise HTTPException(status_code=404, detail="Document not found")
        
        doc = response['hits']['hits'][0]['_source']
        aggs = response['aggregations']
        
        return {
            "document_id": doc_id,
            "filename": doc['filename'],
            "pages": aggs['page_count']['value'],
            "chunks": aggs['total_chunks']['value'],
            "indexed_at": doc['indexed_at']
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    """Health check"""
    try:
        es_health = await es_client.ping()
        return {
            "status": "healthy" if es_health else "unhealthy",
            "service": "document-processing",
            "elasticsearch": es_health,
            "upload_dir": str(UPLOAD_DIR.exists())
        }
    except Exception:
        return {
            "status": "unhealthy",
            "service": "document-processing",
            "elasticsearch": False
        }

if __name__ == "__main__":
    # Check if running under gunicorn
    if "gunicorn" in os.environ.get("SERVER_SOFTWARE", ""):
        # Running under gunicorn, don't start uvicorn
        pass
    else:
        import uvicorn
        # Fallback to uvicorn for development
        uvicorn.run(app, host="0.0.0.0", port=8001)