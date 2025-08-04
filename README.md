# Elasticsearch AI Chat Application

A production-ready Python/React application that provides a conversational interface for querying Elasticsearch using natural language. The application uses Azure OpenAI or OpenAI to generate Elasticsearch queries from user prompts.

## Features

- 🤖 **AI-Powered Query Generation**: Convert natural language to Elasticsearch queries
- 🔍 **Multiple LLM Providers**: Support for Azure OpenAI and OpenAI
- 📊 **Real-time Results**: Execute queries and display results instantly
- 📈 **OpenTelemetry Integration**: Full observability with traces and metrics
- 🐳 **Dockerized**: Ready for production deployment
- 🏥 **Health Checks**: Built-in health monitoring
- 🎨 **Modern UI**: Responsive React frontend
- 🔒 **Security**: Non-root containers, environment-based configuration

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React UI      │───▶│   FastAPI       │───▶│  Elasticsearch  │
│                 │    │   Backend       │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │  Azure OpenAI/  │
                       │     OpenAI      │
                       └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │    Jaeger       │
                       │  (Observability)│
                       └─────────────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Azure OpenAI or OpenAI API access
- Elasticsearch instance (or use the included one)

### 1. Clone and Setup

```bash
git clone <repository-url>
cd elasticsearch-ai-chat
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys and configuration
```

Required environment variables:
- `ELASTICSEARCH_API_KEY`: Your Elasticsearch API key
- `LLM_PROVIDER`: Either "azure" or "openai"
- For Azure: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`
- For OpenAI: `OPENAI_API_KEY`

### 3. Run with Docker Compose

```bash
docker-compose up -d
```

This will start:
- **Application**: http://localhost:8000
- **Elasticsearch**: http://localhost:9200
- **Kibana**: http://localhost:5601
- **Jaeger UI**: http://localhost:16686

### 4. Access the Application

Open your browser and navigate to http://localhost:8000

## Usage

1. **Enter Index Name**: Specify the Elasticsearch index you want to query
2. **Ask Questions**: Use natural language to describe what you're looking for
3. **View Results**: See the generated Elasticsearch query and results
4. **Monitor**: Check the system status and query history in the sidebar

### Example Queries

- "Show me recent orders from the last week"
- "Find users from California with age greater than 25"
- "Count orders by status for today"
- "Show top selling products this month"

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ELASTICSEARCH_HOST` | Elasticsearch host:port | `localhost:9200` |
| `ELASTICSEARCH_API_KEY` | Elasticsearch API key | Required |
| `LLM_PROVIDER` | LLM provider (azure/openai) | `azure` |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint | Required for Azure |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | Required for Azure |
| `AZURE_OPENAI_DEPLOYMENT` | Azure deployment name | `gpt-4` |
| `OPENAI_API_KEY` | OpenAI API key | Required for OpenAI |
| `OPENAI_MODEL` | OpenAI model name | `gpt-4` |

### OpenTelemetry Configuration

The application includes comprehensive OpenTelemetry instrumentation:

- **Traces**: Request tracing across all components
- **Metrics**: Custom metrics for queries and LLM requests
- **Automatic Instrumentation**: FastAPI, HTTP clients, Elasticsearch

## Production Deployment

### Behind Nginx

Since the application is designed to run behind nginx:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: elasticsearch-ai-chat
spec:
  replicas: 3
  selector:
    matchLabels:
      app: elasticsearch-ai-chat
  template:
    metadata:
      labels:
        app: elasticsearch-ai-chat
    spec:
      containers:
      - name: app
        image: elasticsearch-ai-chat:latest
        ports:
        - containerPort: 8000
        env:
        - name: ELASTICSEARCH_API_KEY
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: elasticsearch-api-key
        - name: AZURE_OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: azure-openai-api-key
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Health Checks

The application includes comprehensive health checks:

- **HTTP Health Endpoint**: `GET /health`
- **Docker Health Check**: Built into the container
- **Kubernetes Probes**: Ready for liveness/readiness probes

## Development

### Local Development Setup

```bash
# Install Python dependencies
pip install -r requirements.txt

# Create static directory and copy frontend
mkdir -p static
cp index.html static/

# Set environment variables
export ELASTICSEARCH_API_KEY=your-key
export AZURE_OPENAI_API_KEY=your-key
export AZURE_OPENAI_ENDPOINT=your-endpoint

# Run the application
python main.py
```

### Project Structure

```
├── main.py              # FastAPI backend application
├── requirements.txt     # Python dependencies
├── static/
│   └── index.html      # React frontend
├── Dockerfile          # Container definition
├── docker-compose.yml  # Local development stack
├── .env.example        # Environment variables template
└── README.md          # This file
```

## API Documentation

Once running, visit http://localhost:8000/docs for interactive API documentation.

### Key Endpoints

- `GET /health` - Health check endpoint
- `POST /api/chat` - Chat interface for queries
- `GET /` - Frontend application

## Monitoring and Observability

### Jaeger Tracing

Access the Jaeger UI at http://localhost:16686 to view:
- Request traces across all components
- Performance metrics
- Error tracking
- Service dependencies

### Custom Metrics

The application tracks:
- `elasticsearch_queries_total`: Total Elasticsearch queries
- `llm_requests_total`: Total LLM requests by provider

## Security Considerations

- API keys are loaded from environment variables
- Application runs as non-root user in container
- No sensitive data in logs
- CORS configured for production use
- Input validation on all endpoints

## Troubleshooting

### Common Issues

1. **Elasticsearch Connection Issues**
   - Verify `ELASTICSEARCH_HOST` and `ELASTICSEARCH_API_KEY`
   - Check Elasticsearch health: `curl http://localhost:9200/_cluster/health`

2. **LLM Provider Errors**
   - Verify API keys and endpoints
   - Check quota and rate limits
   - Review logs for detailed error messages

3. **Query Generation Issues**
   - Ensure index exists and has proper mapping
   - Check if index name is correct
   - Review system prompt for data structure alignment

### Logs

View application logs:
```bash
docker-compose logs -f app
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
