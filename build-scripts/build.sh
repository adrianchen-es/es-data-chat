#!/bin/bash

# build-scripts/build.sh
# Docker Buildx setup for multi-platform builds with advanced caching

set -euo pipefail

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
      echo "  --push    Push built images to ${REGISTRY} (requires REGISTRY and VERSION)" >&2
      echo "" >&2
      echo "Environment variables:" >&2
      echo "  SERVICES   Space-separated list of services to build (default: all services)" >&2
      echo "  PLATFORMS  Comma-separated list of platforms (default: linux/amd64,linux/arm64)" >&2
      echo "  REGISTRY   Docker registry prefix (default: localhost:5000)" >&2
      echo "  VERSION    Image tag version (default: latest)" >&2
      echo "" >&2
      echo "Examples:" >&2
      echo "  SERVICES=\"ai-service\" $0               # Build only ai-service" >&2
      echo "  PLATFORMS=\"linux/amd64\" $0            # Build for amd64 only" >&2
      echo "  SERVICES=\"ai-service bff-service\" PLATFORMS=\"linux/arm64\" $0 --push" >&2
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

echo -e "${GREEN}🚀 Starting Docker Buildx multi-platform build${NC}"

# Check whether the registry used for caching is reachable. If not, disable remote cache export
if ! curl -fsS "http://${REGISTRY}/v2/" >/dev/null 2>&1; then
  echo -e "${YELLOW}Registry ${REGISTRY} not reachable — disabling remote cache export (CACHE_FROM/CACHE_TO will be skipped).${NC}"
  CACHE_FROM=""
  CACHE_TO=""
fi

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

# Services to build - can be overridden via SERVICES environment variable (space or comma separated)
DEFAULT_SERVICES=("frontend" "bff-service" "auth-service" "ai-service" "document-service" "cache-service" "vector-service" "security-service" "waf")

# Parse SERVICES environment variable if provided; accept comma or space separated lists
if [ -n "${SERVICES:-}" ]; then
  # normalize commas to spaces, trim, then read into array
  SERVICES_NORMALIZED=$(echo "${SERVICES}" | tr ',' ' ')
  read -ra SERVICES_ARRAY <<< "${SERVICES_NORMALIZED}"
  echo -e "${YELLOW}Building specific services: ${SERVICES_NORMALIZED}${NC}"
else
  SERVICES_ARRAY=("${DEFAULT_SERVICES[@]}")
  echo -e "${YELLOW}Building all services${NC}"
fi

# Validate that specified services exist
ALL_SERVICES=("${DEFAULT_SERVICES[@]}")
for service in "${SERVICES_ARRAY[@]}"; do
  if [[ ! " ${ALL_SERVICES[@]} " =~ " ${service} " ]]; then
    echo -e "${RED}Error: Unknown service '${service}'. Available services: ${ALL_SERVICES[*]}${NC}" >&2
    exit 1
  fi
  if [ ! -f "${service}/Dockerfile" ]; then
    echo -e "${RED}Error: Dockerfile not found for service '${service}' at ${service}/Dockerfile${NC}" >&2
    exit 1
  fi
done

# Normalize PLATFORMS: accept comma or space-separated lists but store comma-separated for buildx
PLATFORMS_NORMALIZED=$(echo "${PLATFORMS}" | tr ' ' ',')
PLATFORMS=${PLATFORMS_NORMALIZED}
echo -e "${YELLOW}Platforms: ${PLATFORMS}${NC}"
echo -e "${YELLOW}Registry: ${REGISTRY}${NC}"
echo -e "${YELLOW}Version: ${VERSION}${NC}"

build_service() {
  local service=$1
  echo -e "${GREEN}🔨 Building ${service}...${NC}"

  # Determine buildx push/load behavior
  local build_platforms="${PLATFORMS}"
  local extra_flags=()
  local cache_flags=()
  local build_args=()

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

  # Only add cache flags if configured
  if [ -n "${CACHE_FROM}" ]; then
    cache_flags+=("--cache-from" "${CACHE_FROM}-${service}")
  fi
  if [ -n "${CACHE_TO}" ]; then
    cache_flags+=("--cache-to" "${CACHE_TO}-${service}")
  fi

  # pass service name into Dockerfile as build-arg to let Dockerfiles optimize per-service steps
  build_args+=("--build-arg" "SERVICE=${service}")

  # Run buildx build with cache flags and build-arg for better layer re-use
  docker buildx build \
    --platform "${build_platforms}" \
    "${cache_flags[@]}" \
    --tag "${REGISTRY}/ai-chat-${service}:${VERSION}" \
    --tag "${REGISTRY}/ai-chat-${service}:latest" \
    --file "${service}/Dockerfile" \
    --progress plain \
    "${build_args[@]}" \
    "${extra_flags[@]}" \
    .
}

# Build all services in parallel
export -f build_service
export PLATFORMS REGISTRY VERSION CACHE_FROM CACHE_TO GREEN NC RED YELLOW PUSH

echo -e "${YELLOW}🏗️  Building ${#SERVICES_ARRAY[@]} services in parallel${NC}"
printf '%s\n' "${SERVICES_ARRAY[@]}" | xargs -P4 -I{} bash -c 'build_service "{}"'

echo -e "${GREEN}✅ All services built successfully${NC}"

# Create multi-service manifest
echo -e "${YELLOW}📋 Creating multi-service build manifest${NC}"
cat > build-manifest.json << EOF
{
  "version": "${VERSION}",
  "platforms": "${PLATFORMS}",
  "registry": "${REGISTRY}",
  "services": {
$(for service in "${SERVICES_ARRAY[@]}"; do
    echo "    \"${service}\": {\"image\": \"${REGISTRY}/ai-chat-${service}:${VERSION}\", \"platforms\": \"${PLATFORMS}\"},"
done | sed '$ s/,$//')
  },
  "built_at": "$(date -Iseconds)",
  "cache_enabled": true
}
EOF

echo -e "${GREEN}🎉 Build complete! Manifest saved to build-manifest.json${NC}"