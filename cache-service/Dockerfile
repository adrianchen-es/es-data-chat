# cache-service/Dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS base

# System dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /app

# Copy and install Python requirements with caching
# Copy and install Python requirements with caching
COPY requirements.txt ./

# Install python build tools (separate layer)
RUN apt-get update && apt-get install -y --no-install-recommends python3-setuptools python3-wheel && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

FROM dependencies AS build
WORKDIR /app

# Copy source after dependencies
# Copy source after dependencies
COPY src/ src/

# Use a lightweight runtime where possible
FROM python:3.11-alpine AS runtime
COPY --from=dependencies /usr/local/bin /usr/local/bin
LABEL org.opencontainers.image.title="Cache Service"
LABEL org.opencontainers.image.description="Multi-layer Redis cache with semantic similarity"

WORKDIR /app

# Create non-root user
RUN adduser --disabled-password --gecos '' cacheuser

# Copy dependencies and source
COPY --from=dependencies /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
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

# If gunicorn is installed, use it with uvicorn workers for process management
if command -v gunicorn >/dev/null 2>&1; then
    exec gunicorn -k uvicorn.workers.UvicornWorker "$APP_MODULE" -b 0.0.0.0:8002 --workers ${WORKERS:-2}
else
    # Fallback to running uvicorn directly via python -m to ensure the module path works
    exec python -m uvicorn "$APP_MODULE" --host 0.0.0.0 --port 8002
fi
EOF

CMD ["/usr/local/bin/entrypoint.sh"]