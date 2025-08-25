# document-service/Dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS base

# System dependencies for PyMuPDF and file processing
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libmagic1 \
    libmagic-dev \
    file \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /app

# Copy requirements and install with cache
COPY requirements.txt ./

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

FROM dependencies AS build
WORKDIR /app

# Copy source after dependencies
COPY src/ src/

FROM python:3.11-alpine AS runtime
COPY --from=dependencies /usr/local/bin /usr/local/bin
LABEL org.opencontainers.image.title="Document Processing Service"
LABEL org.opencontainers.image.description="PyMuPDF4LLM document processing with Elasticsearch indexing"

WORKDIR /app

# Runtime dependencies
RUN apt-get update && apt-get install -y \
    libmagic1 \
    file \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN adduser --disabled-password --gecos '' docuser

# Create upload directories
RUN mkdir -p /tmp/uploads /tmp/uploads/images && \
    chown -R docuser:docuser /tmp/uploads

# Copy dependencies and source
COPY --from=dependencies /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=build --chown=docuser:docuser /app .

USER docuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8001/health', timeout=5)"

EXPOSE 8001

# Entrypoint: prefer gunicorn with uvicorn workers if available, otherwise use uvicorn module
COPY --chown=docuser:docuser --chmod=755 <<'EOF' /usr/local/bin/entrypoint.sh
#!/bin/sh
set -e

# Allow overriding the ASGI app module via APP_MODULE env var
APP_MODULE=${APP_MODULE:-src.main:app}

# If gunicorn is installed, use it with uvicorn workers for process management
if command -v gunicorn >/dev/null 2>&1; then
    exec gunicorn -k uvicorn.workers.UvicornWorker "$APP_MODULE" -b 0.0.0.0:8001 --workers ${WORKERS:-2}
else
    # Fallback to running uvicorn directly via python -m to ensure the module path works
    exec python -m uvicorn "$APP_MODULE" --host 0.0.0.0 --port 8001
fi
EOF

CMD ["/usr/local/bin/entrypoint.sh"]