.DEFAULT_GOAL := help

# Compose helpers
COMPOSE_BUILDX := docker-compose -f docker-compose.buildx.yml
COMPOSE_DEV := docker-compose -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help build buildx push up dev-up down logs ps health init-keycloak clean prune
.PHONY: smoke-ai smoke-all


help:
	@echo "Usage: make <target> [VARIABLE=value]"
	@echo ""
	@echo "Targets:"
	@echo "  build         Run local build script (build-scripts/build.sh)"
	@echo "  buildx        Build images using docker-compose.buildx.yml"
	@echo "  push          Push built images (requires REGISTRY and VERSION)"
	@echo "  up            Start production stack (docker-compose.buildx.yml)"
	@echo "  dev-up        Start dev stack (docker-compose.yml + docker-compose.dev.yml)"
	@echo "  down          Stop all services"
	@echo "  logs [service] Follow logs; optionally set service=name"
	@echo "  ps            Show containers"
	@echo "  health        Run health checks for services & infra"
	@echo "  init-keycloak Initialize Keycloak realm/client (requires ADMIN_TOKEN env var)"
	@echo "  clean         Bring down, remove volumes and local images"
	@echo "  prune         Docker system prune -af"
	@echo ""
	@echo "Environment variables: REGISTRY, VERSION, ADMIN_TOKEN, EXTERNAL_ELASTICSEARCH_URL"

build:
	@chmod +x build-scripts/build.sh
	@bash build-scripts/build.sh

buildx:
	@$(COMPOSE_BUILDX) build --parallel

push:
	@if [ -z "$(REGISTRY)" ] || [ -z "$(VERSION)" ]; then \
		echo "REGISTRY and VERSION must be set to push (e.g. REGISTRY=your-registry.com VERSION=1.0.0 make push)"; \
		exit 1; \
	fi
	@echo "Pushing images to $(REGISTRY) with tag $(VERSION)..."
	@docker-compose -f docker-compose.buildx.yml push



up:
	@bash -c '\
if [ -n "${EXTERNAL_ELASTICSEARCH_URL-}" ]; then \
		echo "Using external Elasticsearch at ${EXTERNAL_ELASTICSEARCH_URL}. Starting infra (qdrant, redis, keycloak, otel-collector) first..."; \
		$(COMPOSE_BUILDX) up -d --remove-orphans qdrant redis keycloak keycloak-db otel-collector; \
		echo "Now starting application services without local elasticsearch..."; \
		$(COMPOSE_BUILDX) up -d --remove-orphans waf frontend bff-service auth-service ai-service document-service vector-service cache-service security-service; \
	else \
		$(COMPOSE_BUILDX) up -d; \
	fi'


dev-up:
	@bash -c '\
if [ -n "${EXTERNAL_ELASTICSEARCH_URL-}" ]; then \
		echo "Using external Elasticsearch at ${EXTERNAL_ELASTICSEARCH_URL}. Starting infra (qdrant, redis, keycloak, otel-collector) first..."; \
		$(COMPOSE_DEV) up -d --remove-orphans qdrant redis keycloak keycloak-db otel-collector; \
		echo "Now starting dev application services without local elasticsearch..."; \
		$(COMPOSE_DEV) up -d --remove-orphans waf frontend bff-service auth-service ai-service document-service vector-service cache-service security-service; \
	else \
		$(COMPOSE_DEV) up -d; \
	fi'

down:
	@docker-compose down

logs:
	@sh -c 'if [ -n "$(service)" ]; then docker-compose logs -f $(service); else docker-compose logs -f --tail=200; fi'

ps:
	@docker-compose ps


health:
	@bash -c '\
set -euo pipefail; \
services=("waf:80" "frontend:3000" "bff-service:3001" "ai-service:8000" "document-service:8001" "cache-service:8002" "auth-service:8003" "vector-service:8004" "security-service:8005"); \
for s in "${services[@]}"; do \
	name=$${s%%:*}; port=$${s##*:}; \
	echo -n "Checking $${name}... "; \
	if [ "$${name}" = waf ] || [ "$${name}" = frontend ]; then \
		curl -fsS "http://localhost:$${port}/" >/dev/null && echo OK || echo UNHEALTHY; \
	else \
		curl -fsS "http://localhost:$${port}/health" >/dev/null && echo OK || echo UNHEALTHY; \
	fi; \
done; \
ES_URL="${EXTERNAL_ELASTICSEARCH_URL:-http://localhost:9200}"; \
echo -n "Elasticsearch ($${ES_URL})... "; curl -fsS "$${ES_URL}/_cluster/health" >/dev/null && echo OK || echo UNHEALTHY; \
echo -n "Qdrant... "; curl -fsS http://localhost:6333/collections >/dev/null && echo OK || echo UNHEALTHY; \
echo -n "Keycloak... "; curl -fsS http://localhost:8080/health >/dev/null && echo OK || echo UNHEALTHY; \
'

init-keycloak:
	@bash -c '\
	if [ -z "${ADMIN_TOKEN-}" ]; then echo "Set ADMIN_TOKEN then run: make init-keycloak ADMIN_TOKEN=..."; exit 1; fi; \
	curl -s -X POST http://localhost:8080/auth/admin/realms -H "Authorization: Bearer $${ADMIN_TOKEN}" -H "Content-Type: application/json" -d '\''{"realm":"ai-chat","enabled":true,"clients":[{"clientId":"ai-chat-client","enabled":true,"publicClient":false,"redirectUris":["http://localhost/*"]}]}'\'' | jq . || true \
	'

clean:
	@docker-compose down -v --remove-orphans
	@docker image prune -f

prune:
	@docker system prune -af


# Smoke tests (quick integration checks that assume services are running)
smoke-ai:
	@bash -c '\
set -euo pipefail; \
echo "Running AI service smoke tests..."; \
./scripts/smoke/ai_smoke.sh; \
echo "AI smoke tests passed."; \
'

smoke-all: smoke-ai
	@echo "All smoke tests passed."
