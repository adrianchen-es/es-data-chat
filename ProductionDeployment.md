# Production Deployment Guide

## Prerequisites

### System Requirements
- **CPU**: 8 cores minimum (16 recommended)
- **RAM**: 16GB minimum (32GB recommended)  
- **Storage**: 100GB SSD minimum
- **Network**: 1Gbps bandwidth recommended

### Required Software
- Docker 24.0+
- Docker Compose 2.20+
- Docker Buildx enabled
- Git

## Quick Production Setup

### 1. Clone and Configure
```bash
git clone <repository-url>
cd ai-chat-application
cp .env.example .env
# Edit .env with your API keys and configuration
```

### 2. Build Multi-Platform Images
```bash
# Setup Docker Buildx
docker buildx create --name production --use
docker buildx inspect --bootstrap

# Build all services
chmod +x build-scripts/build.sh
export REGISTRY=your-registry.com
export VERSION=1.0.0
./build-scripts/build.sh
```

### 3. Deploy Services
```bash
# If you have an external Elasticsearch instance, export it so the compose stack will skip local ES
# Example: export EXTERNAL_ELASTICSEARCH_URL=http://es-host:9200
docker-compose -f docker-compose.buildx.yml up -d
```

### 4. Initialize Keycloak
```bash
# Wait for Keycloak to start
sleep 60

# Create AI Chat realm and client
curl -X POST http://localhost:8080/auth/admin/realms \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "realm": "ai-chat",
    "enabled": true,
    "clients": [{
      "clientId": "ai-chat-client",
      "enabled": true,
      "publicClient": false,
      "redirectUris": ["http://localhost/*"]
    }]
  }'
```

## Health Verification

### Service Health Checks
```bash
# Check all 10 services
services=("waf:80" "frontend:3000" "bff-service:3001" "ai-service:8000" 
          "document-service:8001" "cache-service:8002" "auth-service:8003"
          "vector-service:8004" "security-service:8005")

for service in "${services[@]}"; do
  name=${service%:*}
  port=${service#*:}
  echo "Checking $name..."
  if [[ "$name" == "waf" || "$name" == "frontend" ]]; then
    curl -f http://localhost:$port/ || echo "$name unhealthy"
  else
    curl -f http://localhost:$port/health || echo "$name unhealthy"
  fi
done

# Infrastructure health — if using an external Elasticsearch, set EXTERNAL_ELASTICSEARCH_URL
ES_URL=${EXTERNAL_ELASTICSEARCH_URL:-http://localhost:9200}
curl -f $ES_URL/_cluster/health || echo "Elasticsearch unhealthy"
curl -f http://localhost:6333/collections || echo "Qdrant unhealthy"
curl -f http://localhost:8080/health || echo "Keycloak unhealthy"
```

### End-to-End Test
```bash
# Test authentication
TOKEN=$(curl -X POST http://localhost:8080/auth/realms/ai-chat/protocol/openid-connect/token \
  -d "client_id=ai-chat-client" \
  -d "username=testuser" \
  -d "password=testpass" \
  -d "grant_type=password" | jq -r .access_token)

# Test AI chat
curl -X POST http://localhost/api/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, how are you?", "user_id": "test-user"}'
```

## Performance Tuning

### Elasticsearch Optimization
```bash
# Increase heap size for production
echo "ES_JAVA_OPTS=-Xms4g -Xmx4g" >> .env

# Enable security if needed
echo "ELASTICSEARCH_SECURITY_ENABLED=true" >> .env
```

### Resource Limits (docker-compose.yml)
```yaml
services:
  ai-service:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

### Connection Pool Tuning
```bash
# Increase connection pools for high load
# In ai-service environment:
MAX_CONNECTIONS=50
POOL_SIZE=20
TIMEOUT=30
```

## Security Configuration

### SSL/TLS Setup
```bash
# Generate SSL certificates
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout waf/ssl/nginx.key \
  -out waf/ssl/nginx.crt

# Update nginx.conf to enable HTTPS
sed -i 's/#ssl_certificate/ssl_certificate/' waf/nginx.conf
```

### Firewall Rules
```bash
# Allow only necessary ports
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp
ufw --force enable
```

## Monitoring Setup

### Prometheus & Grafana (Optional)
```bash
# Add to docker-compose.yml
prometheus:
  image: prom/prometheus:latest
  ports: ["9090:9090"]

grafana:
  image: grafana/grafana:latest  
  ports: ["3001:3000"]
```

### Log Aggregation
```bash
# Centralized logging with ELK stack
elasticsearch-logs:
  image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
  environment:
    - "ES_JAVA_OPTS=-Xms1g -Xmx1g"
```

## Backup Strategy

### Database Backups
```bash
# Elasticsearch snapshots
curl -X PUT "localhost:9200/_snapshot/backup" -H 'Content-Type: application/json' -d'
{
  "type": "fs",
  "settings": {
    "location": "/usr/share/elasticsearch/backup"
  }
}'

# Create snapshot
curl -X PUT "localhost:9200/_snapshot/backup/snapshot_1"
```

### Volume Backups
```bash
# Backup Docker volumes
docker run --rm -v es_data:/data -v $(pwd)/backups:/backup \
  alpine tar czf /backup/es_data_$(date +%Y%m%d).tar.gz -C /data .
```

## Scaling & Load Balancing

### Horizontal Scaling
```bash
# Scale specific services
docker-compose up -d --scale ai-service=3 --scale bff-service=2
```

### Load Balancer Configuration (nginx upstream)
```nginx
upstream ai_backend {
    server ai-service-1:8000;
    server ai-service-2:8000;  
    server ai-service-3:8000;
}
```

## Troubleshooting

### Common Issues
1. **Keycloak fails to start**: Check PostgreSQL connection
2. **AI service 503 errors**: Verify API keys in environment
3. **Slow responses**: Check Elasticsearch heap size
4. **WAF blocking valid requests**: Adjust ModSecurity rules

### Log Locations
```bash
# Service logs
docker-compose logs -f service-name

# WAF logs
tail -f waf/logs/security.log

# Application logs  
docker exec -it ai-service tail -f /app/logs/app.log
```

### Resource Monitoring
```bash
# Container resource usage
docker stats

# System resources
htop
df -h
```

## Production Checklist

- [ ] All environment variables configured
- [ ] SSL certificates installed
- [ ] Firewall rules applied
- [ ] Backup strategy implemented
- [ ] Monitoring dashboards created
- [ ] Load testing completed
- [ ] Security scan performed
- [ ] Documentation updated
- [ ] Team trained on operations

## Support

For production issues:
1. Check service logs: `docker-compose logs service-name`
2. Verify health endpoints: `curl localhost:port/health`
3. Monitor resource usage: `docker stats`
4. Review security logs: `tail -f waf/logs/security.log`