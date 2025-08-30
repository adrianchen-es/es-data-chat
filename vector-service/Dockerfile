# vector-service/Dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.12-alpine AS base

# System dependencies
RUN apk update && apk upgrade
RUN apk add --no-cache \
    build-base \
    gcc \
    g++ \
    python3-dev \
    openssl-dev

FROM base AS dependencies
WORKDIR /app

# Copy requirements first to leverage layer caching
# Copy requirements first to leverage layer caching
COPY requirements.txt ./

# Install python build tooling
RUN apk add --no-cache py3-pip py3-setuptools py3-wheel

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

FROM dependencies AS build
WORKDIR /app

# Copy source after installing dependencies
COPY src/ src/

FROM python:3.12-alpine AS runtime
COPY --from=dependencies /usr/local/bin /usr/local/bin
LABEL org.opencontainers.image.title="Vector Database Service"
LABEL org.opencontainers.image.description="Qdrant vector database service for semantic caching"

WORKDIR /app

# Create non-root user
RUN adduser --disabled-password --gecos '' vectoruser

# Copy dependencies and source
COPY --from=dependencies /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=build --chown=vectoruser:vectoruser /app .

USER vectoruser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8004/health', timeout=5)"

EXPOSE 8004

# Entrypoint: prefer gunicorn with uvicorn workers if available, otherwise use uvicorn module
COPY --chown=vectoruser:vectoruser --chmod=755 <<'EOF' /usr/local/bin/entrypoint.sh
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
    exec python -m gunicorn -k uvicorn.workers.UvicornWorker "$APP_MODULE" -b 0.0.0.0:8004 --workers ${WORKERS:-2}
else
    # Fallback to running uvicorn directly via python -m to ensure the module path works
    exec python -m uvicorn "$APP_MODULE" --host 0.0.0.0 --port 8004
fi
EOF

CMD ["/usr/local/bin/entrypoint.sh"]