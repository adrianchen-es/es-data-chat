# cache-service/Dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.12-alpine AS base

# System dependencies
RUN apk update && apk upgrade
RUN apk add --no-cache \
    build-base \
    python3-dev \
    libffi-dev

# System dependencies for cryptography
RUN apk add --no-cache \
    gcc \
    g++ \

FROM base AS dependencies
WORKDIR /app

# Copy and install Python requirements with caching
# Copy and install Python requirements with caching
COPY requirements.txt ./

RUN apk add --no-cache py3-pip py3-setuptools py3-wheel

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

FROM dependencies AS build
WORKDIR /app

# Copy source after dependencies
# Copy source after dependencies
COPY src/ src/

# Use a lightweight runtime where possible
FROM python:3.12-alpine AS runtime
COPY --from=dependencies /usr/local/bin /usr/local/bin
LABEL org.opencontainers.image.title="Cache Service"
LABEL org.opencontainers.image.description="Multi-layer Redis cache with semantic similarity"

WORKDIR /app

# Create non-root user
RUN adduser --disabled-password --gecos '' cacheuser

# Copy dependencies and source
COPY --from=dependencies /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=build --chown=cacheuser:cacheuser /app .

USER cacheuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
        CMD python -c "import httpx; httpx.get('http://localhost:8002/health', timeout=3)"

EXPOSE 8002

# Entrypoint: prefer gunicorn with uvicorn workers if available, otherwise use uvicorn module
COPY --chown=cacheuser:cacheuser --chmod=755 <<'EOF' /usr/local/bin/entrypoint.sh
#!/bin/sh
set -e

# Allow overriding the ASGI app module via APP_MODULE env var
APP_MODULE=${APP_MODULE:-src.cache:app}

if python - <<'PY' 2>/dev/null
import importlib,sys
try:
    importlib.util.find_spec('gunicorn')
    sys.exit(0)
except Exception:
    sys.exit(1)
PY
then
    exec python -m gunicorn -k uvicorn.workers.UvicornWorker "$APP_MODULE" -b 0.0.0.0:8002 --workers ${WORKERS:-2}
else
    # Fallback to running uvicorn directly via python -m to ensure the module path works
    exec python -m uvicorn "$APP_MODULE" --host 0.0.0.0 --port 8002
fi
EOF

CMD ["/usr/local/bin/entrypoint.sh"]