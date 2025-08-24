# build-scripts/build.sh
#!/bin/bash

# Docker Buildx setup for multi-platform builds with advanced caching

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REGISTRY=${REGISTRY:-"localhost:5000"}
VERSION=${VERSION:-"latest"}
PLATFORMS=${PLATFORMS:-"linux/amd64,linux/arm64"}
CACHE_FROM=${CACHE_FROM:-"type=registry,ref=${REGISTRY}/ai-chat-cache"}
CACHE_TO=${CACHE_TO:-"type=registry,ref=${REGISTRY}/ai-chat-cache,mode=max"}

echo -e "${GREEN}🚀 Starting Docker Buildx multi-platform build${NC}"

# Create buildx builder if it doesn't exist
if ! docker buildx ls | grep -q "ai-chat-builder"; then
    echo -e "${YELLOW}📦 Creating buildx builder 'ai-chat-builder'${NC}"
    docker buildx create --name ai-chat-builder --driver docker-container --use
    docker buildx inspect --bootstrap
fi

# Use existing builder
docker buildx use ai-chat-builder

# Services to build
SERVICES=(
    "frontend"
    "bff-service"
    "auth-service" 
    "ai-service"
    "document-service"
    "cache-service"
    "vector-service"
    "security-service"
    "waf"
)

build_service() {
    local service=$1
    echo -e "${GREEN}🔨 Building ${service}...${NC}"
    
    docker buildx build \
        --platform ${PLATFORMS} \
        --cache-from ${CACHE_FROM}-${service} \
        --cache-to ${CACHE_TO}-${service} \
        --tag ${REGISTRY}/ai-chat-${service}:${VERSION} \
        --tag ${REGISTRY}/ai-chat-${service}:latest \
        --file ${service}/Dockerfile \
        --context ${service} \
        --progress plain \
        --push \
        ${service}/
}

# Build all services in parallel
export -f build_service
export PLATFORMS REGISTRY VERSION CACHE_FROM CACHE_TO GREEN NC RED

echo -e "${YELLOW}🏗️  Building ${#SERVICES[@]} services in parallel${NC}"
printf '%s\n' "${SERVICES[@]}" | xargs -n1 -P4 -I{} bash -c 'build_service "{}"'

echo -e "${GREEN}✅ All services built successfully${NC}"

# Create multi-service manifest
echo -e "${YELLOW}📋 Creating multi-service build manifest${NC}"
cat > build-manifest.json << EOF
{
  "version": "${VERSION}",
  "platforms": "${PLATFORMS}",
  "registry": "${REGISTRY}",
  "services": {
$(for service in "${SERVICES[@]}"; do
    echo "    \"${service}\": {\"image\": \"${REGISTRY}/ai-chat-${service}:${VERSION}\", \"platforms\": \"${PLATFORMS}\"},"
done | sed '$ s/,$//')
  },
  "built_at": "$(date -Iseconds)",
  "cache_enabled": true
}
EOF

echo -e "${GREEN}🎉 Build complete! Manifest saved to build-manifest.json${NC}"