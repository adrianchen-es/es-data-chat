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

# CLI flags
PUSH=false

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      PUSH=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--push]" >&2
      echo "  --push    Push built images to \
$REGISTRY (requires REGISTRY and VERSION)" >&2
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

echo -e "${GREEN}🚀 Starting Docker Buildx multi-platform build${NC}"

# Dependency checks
command -v docker >/dev/null 2>&1 || { echo -e "${RED}docker not found. Install Docker and ensure it's on your PATH.${NC}"; exit 1; }
if ! docker info >/dev/null 2>&1; then
  echo -e "${RED}Docker daemon doesn't appear to be running or you lack permissions. Run Docker Desktop or ensure the daemon is available.${NC}"
  exit 1
fi

# Check buildx availability
if ! docker buildx version >/dev/null 2>&1; then
  echo -e "${YELLOW}docker buildx not available. Enabling buildx or install Docker Buildx plugin is required.${NC}"
  # try to continue as some Docker versions include buildx but return non-zero; attempt to create builder later
fi

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
    
  # Determine buildx push/load behavior
  local build_platforms="${PLATFORMS}"
  local extra_flags=()

  if [ "${PUSH}" = true ]; then
    extra_flags+=("--push")
  else
    # For local testing: if multi-platform requested, fall back to local single-platform load (amd64)
    if echo "${PLATFORMS}" | grep -q ','; then
      echo -e "${YELLOW}Multi-platform build requested but --push not set; defaulting to linux/amd64 and --load for local testing.${NC}"
      build_platforms="linux/amd64"
      extra_flags+=("--load")
    else
      extra_flags+=("--load")
    fi
  fi

  docker buildx build \
    --platform "${build_platforms}" \
    --cache-from "${CACHE_FROM}-${service}" \
    --cache-to "${CACHE_TO}-${service}" \
    --tag "${REGISTRY}/ai-chat-${service}:${VERSION}" \
    --tag "${REGISTRY}/ai-chat-${service}:latest" \
    --file "${service}/Dockerfile" \
    --context "${service}" \
    --progress plain \
    "${extra_flags[@]}" \
    "${service}/"
}

# Build all services in parallel
export -f build_service
export PLATFORMS REGISTRY VERSION CACHE_FROM CACHE_TO GREEN NC RED YELLOW PUSH

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