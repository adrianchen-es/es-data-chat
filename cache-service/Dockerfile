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
COPY cache-service/requirements.txt ./

# Install python build tools (separate layer)
RUN apt-get update && apt-get install -y --no-install-recommends python3-setuptools python3-wheel && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

FROM dependencies AS build
WORKDIR /app

# Copy source after dependencies
COPY cache-service/src/ src/

FROM python:3.11-alpine AS runtime
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

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8002"]