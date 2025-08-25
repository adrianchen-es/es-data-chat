# ai-service/Dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.12-alpine AS base

# System dependencies with cache
ENV DEBIAN_FRONTEND=noninteractive
RUN apk update && apk upgrade
RUN apk add --no-cache \
    build-base \
    python3-dev \
    libffi-dev \
    openssl-dev

FROM base AS dependencies
WORKDIR /app

# Copy only requirements first to leverage docker layer caching
COPY ai-service/requirements.txt ./

# Ensure system-level build deps are installed (separate layer)
RUN apk add --no-cache py3-pip py3-setuptools py3-wheel

# Install Python build tools and Python requirements (cache pip downloads)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

FROM dependencies AS build
WORKDIR /app

# Copy source code after dependencies to avoid invalidating pip layer
COPY ai-service/src/ src/
COPY shared/ shared/

FROM python:3.12-alpine AS runtime
RUN apk update && apk upgrade
COPY --from=dependencies /usr/local/bin /usr/local/bin
LABEL org.opencontainers.image.title="AI Chat Service"
LABEL org.opencontainers.image.description="Multi-model AI service with RAG"

WORKDIR /app

# Create non-root user
RUN adduser --disabled-password --gecos '' appuser

# Copy dependencies and source
COPY --from=dependencies /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=build --chown=appuser:appuser /app .

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health', timeout=5)"

EXPOSE 8000

# Entrypoint: prefer gunicorn with uvicorn workers if available, otherwise use uvicorn module
COPY --chown=appuser:appuser --chmod=755 <<'EOF' /usr/local/bin/entrypoint.sh
#!/bin/sh
set -e

# Allow overriding the ASGI app module via APP_MODULE env var
APP_MODULE=${APP_MODULE:-src.main:app}

# If gunicorn is installed, use it with uvicorn workers for process management
if python - <<'PY' 2>/dev/null
import importlib,sys
try:
    importlib.util.find_spec('gunicorn')
    sys.exit(0)
except Exception:
    sys.exit(1)
PY
then
    exec python -m gunicorn -k uvicorn.workers.UvicornWorker "$APP_MODULE" -b 0.0.0.0:8000 --workers ${WORKERS:-2}
else
    # Fallback to running uvicorn directly via python -m to ensure the module path works
    exec python -m uvicorn "$APP_MODULE" --host 0.0.0.0 --port 8000
fi
EOF

CMD ["/usr/local/bin/entrypoint.sh"]