# shared/elasticsearch/client.py
from elasticsearch import AsyncElasticsearch
from elasticsearch.exceptions import ConnectionError, NotFoundError
import ssl
import os
from typing import Optional, Dict, List
from opentelemetry import trace
import asyncio

tracer = trace.get_tracer(__name__)

class EnhancedElasticsearchClient:
    def __init__(self):
        self.client = None
        self.pool = None
        self._setup_client()
    
    def _setup_client(self):
        """Configure Elasticsearch client with connection pooling"""
        config = {
            'hosts': [os.getenv('ELASTICSEARCH_URL', 'http://localhost:9200')],
            'timeout': 30,
            'max_retries': 3,
            'retry_on_timeout': True,
            'maxsize': 20,  # Connection pool size
        }
        
        # API Key authentication
        api_key = os.getenv('ELASTICSEARCH_API_KEY')
        if api_key:
            config['api_key'] = api_key
        
        # Certificate verification
        verify_certs = os.getenv('ELASTICSEARCH_VERIFY_CERTS', 'true').lower() == 'true'
        if not verify_certs:
            config['verify_certs'] = False
            config['ssl_show_warn'] = False
        
        # CA certificate path
        ca_certs = os.getenv('ELASTICSEARCH_CA_CERTS')
        if ca_certs:
            config['ca_certs'] = ca_certs
        
        self.client = AsyncElasticsearch(**config)
    
    async def ensure_index(self, index_name: str, mapping: Dict):
        """Create index if it doesn't exist"""
        with tracer.start_as_current_span("es_ensure_index") as span:
            span.set_attribute("es.index", index_name)
            
            try:
                exists = await self.client.indices.exists(index=index_name)
                if not exists:
                    await self.client.indices.create(index=index_name, body=mapping)
                    span.set_attribute("es.index_created", True)
            except Exception as e:
                span.record_exception(e)
                raise
    
    async def semantic_search(self, index: str, query: str, filters: Dict = None, size: int = 10):
        """Enhanced semantic search with aggregations"""
        with tracer.start_as_current_span("es_semantic_search") as span:
            search_body = {
                "query": {
                    "bool": {
                        "must": [
                            {
                                "multi_match": {
                                    "query": query,
                                    "fields": ["content^2", "title^1.5", "metadata.description"],
                                    "type": "best_fields",
                                    "fuzziness": "AUTO",
                                    "minimum_should_match": "75%"
                                }
                            }
                        ]
                    }
                },
                "highlight": {
                    "fields": {
                        "content": {
                            "fragment_size": 150,
                            "number_of_fragments": 3
                        }
                    }
                },
                "aggs": {
                    "document_types": {
                        "terms": {"field": "metadata.document_type.keyword"}
                    },
                    "avg_score": {
                        "avg": {"script": "_score"}
                    }
                },
                "size": size,
                "sort": [
                    {"_score": {"order": "desc"}},
                    {"indexed_at": {"order": "desc"}}
                ]
            }
            
            if filters:
                search_body["query"]["bool"]["filter"] = [
                    {"terms": {k: v}} for k, v in filters.items()
                ]
            
            response = await self.client.search(index=index, body=search_body)
            
            span.set_attributes({
                "es.hits": response['hits']['total']['value'],
                "es.took": response['took']
            })
            
            return response
    
    async def batch_index(self, index: str, documents: List[Dict]):
        """Efficient batch indexing"""
        with tracer.start_as_current_span("es_batch_index") as span:
            actions = []
            for doc in documents:
                actions.extend([
                    {"index": {"_index": index, "_id": doc.get('id')}},
                    {k: v for k, v in doc.items() if k != 'id'}
                ])
            
            if actions:
                response = await self.client.bulk(body=actions, refresh=True)
                
                span.set_attributes({
                    "es.documents": len(documents),
                    "es.errors": len(response.get('errors', []))
                })
                
                return response
            
            return None
    
    async def health_check(self):
        """Check Elasticsearch cluster health"""
        try:
            health = await self.client.cluster.health()
            return {
                "status": health['status'],
                "nodes": health['number_of_nodes'],
                "active_shards": health['active_shards']
            }
        except Exception as e:
            return {"status": "red", "error": str(e)}
    
    async def close(self):
        """Close client connections"""
        if self.client:
            await self.client.close()