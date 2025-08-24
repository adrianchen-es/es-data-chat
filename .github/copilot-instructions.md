<!-- .github/copilot-instructions.md - Guidance for AI coding agents -->
# Copilot instructions for es-data-chat

Purpose: short, actionable notes to make an AI coding agent productive in this repository.

High-level architecture (what to know first)
- This repo is an 10-service microservice stack (see `README.md` and `ServiceStructure.md`).
- Important components:
  - WAF (`waf/`) acting as the gateway (ModSecurity rules in `waf/custom-rules.conf`).
  - Frontend (`frontend/`) — React/TypeScript app built into an nginx image.
  - BFF (`bff-service/`) — Fastify Node.js API that proxies/validates requests to backend services.
  - Python services (`*-service/`) — `ai-service`, `document-service`, `auth-service`, `cache-service`, `vector-service`, `security-service`. Each uses FastAPI and exposes `/health` and REST endpoints.
  - Infra: Elasticsearch, Qdrant, Redis, Keycloak, OpenTelemetry Collector are run via docker-compose.

Where data flows and why it matters
- User → WAF → Frontend → BFF → AI Service (RAG) → Elasticsearch / Vector Service (Qdrant) → Cache (Redis).
- AI model calls are performed inside `ai-service/` and use multi-provider keys (OpenAI/Anthropic/Azure).  The service consults `EXTERNAL_ELASTICSEARCH_URL` or the local Elasticsearch container.
- Document ingestion pipeline lives in `document-service/` (uploads stored under the compose `doc_uploads` volume).

Developer workflows and key commands (what you'll run)
- Build for development: `make build` (runs `build-scripts/build.sh`) — prefer this for local iterative builds.
- Build multi-platform images: `make buildx` uses `docker-compose.buildx.yml` with BuildKit options.
- Start production stack: `make up` (uses `docker-compose.buildx.yml`).
- Start dev stack with live reload: `make dev-up` (uses `docker-compose.yml` + `docker-compose.dev.yml`).
- Health checks: `make health` (calls `/health` on services and checks infra endpoints).
- Inspect logs: `make logs service=<name>` or `docker-compose logs -f <service>`.
- Init Keycloak realm/client: `make init-keycloak ADMIN_TOKEN=...` (requires admin token).

Project-specific conventions and patterns (do not assume defaults)
- Services expose a `/health` endpoint for the Makefile health target — prefer adding tests that call that endpoint.
- Environment variables are favored for switching infra: `EXTERNAL_ELASTICSEARCH_URL` disables the local ES container. When present, many services read `ELASTICSEARCH_URL` from this.
- OpenTelemetry is wired into most services using `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317` in compose files — keep tracing spans and resource attributes consistent.
- Caching and similarity thresholds: the codebase uses an 0.85 similarity threshold (`CACHE_HIT_THRESHOLD` in README) and Qdrant for vector caching — follow these numeric constants where applicable.
- Security-first: WAF custom rules in `waf/custom-rules.conf`, Pydantic-based input validation in Python services, and PII redaction in structured logs. Changes touching inputs, logs, or external model prompts must preserve redaction behavior.

Where to find important code examples
- Multi-provider AI selection: see `ai-service/src/main.py` for provider selection, fallback, and environment variable usage (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`).
- Elasticsearch client helpers: `shared/elasticsearch/client.py` shows how services connect to ES with `ELASTICSEARCH_API_KEY` and the `ELASTICSEARCH_VERIFY_CERTS` flag.
- Build and CI assumptions: `build-scripts/build.sh` and `docker-compose.buildx.yml` expect BuildKit and optionally GitHub Actions cache settings (see `x-build-config`).
- WAF testing: `waf/test-security-rules.sh` runs example requests against the WAF; useful when changing rules or upstream payload sanitization.

Code patterns to follow
- FastAPI services: rely on Pydantic models for request/response shapes. Keep schema changes backward compatible and update `/health` as needed.
- Configuration: prefer reading config from environment and fallback to compose defaults. Mirror the `docker-compose.yml` environment variables when adding new options.
- Tracing/logging: attach OTEL resource attributes the same way as existing services; do not remove structured logging or PII redaction hooks.

Quick examples (copyable snippets to use in edits)
- Health-check curl used by `make health`:
  - `curl -fsS http://localhost:8000/health`  # AI service health endpoint
- Use external ES without starting local ES:
  - `EXTERNAL_ELASTICSEARCH_URL=http://es-host:9200 make dev-up`

Testing and verification guidance
- After changes that affect service startup, run `make dev-up` then `make health` and tail logs with `make logs service=<name>`.
- If changing WAF rules, run `waf/test-security-rules.sh` and verify ModSecurity logs under `waf/logs` volume.
- For new HTTP endpoints, add a minimal integration smoke-test that calls the endpoint and checks `/health` for the dependent services.

What not to change without explicit checks
- Java heap / ES memory flags in `docker-compose.yml` (`ES_JAVA_OPTS=-Xms2g -Xmx2g`) — changing without capacity testing can break local dev runs.
- WAF/ModSecurity rule IDs and core rule set ordering — misordering causes false positives.
- OTEL collector pipeline shape in `otel-collector.yaml` — changing exporters or processors requires running local tracing smoke tests.

Helpful files to inspect for context
- `README.md`, `ServiceStructure.md`, `Makefile`
- `docker-compose.yml`, `docker-compose.buildx.yml`, `build-scripts/build.sh`
- `waf/custom-rules.conf`, `waf/test-security-rules.sh`
- `shared/elasticsearch/client.py`, `ai-service/src/main.py`, `bff-service/src/index.js`

If anything in these notes is unclear or you need more examples (tests, request/response shapes, or specific file walkthroughs), ask and I'll expand the relevant section.
