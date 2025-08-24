# ai-service/Dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS base

# System dependencies with cache
ENV DEBIAN_FRONTEND=noninteractive
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /app

# Copy only requirements first to leverage docker layer caching
COPY ai-service/requirements.txt ./

# Ensure system-level build deps are installed (separate layer)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3-setuptools python3-wheel && \
    rm -rf /var/lib/apt/lists/*

# Install Python build tools and Python requirements (cache pip downloads)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

FROM dependencies AS build
WORKDIR /app

# Copy source code after dependencies to avoid invalidating pip layer
COPY ai-service/src/ src/
COPY shared/ shared/

FROM python:3.11-alpine AS runtime
LABEL org.opencontainers.image.title="AI Chat Service"
LABEL org.opencontainers.image.description="Multi-model AI service with RAG"

WORKDIR /app

# Create non-root user
RUN adduser --disabled-password --gecos '' appuser

# Copy dependencies and source
COPY --from=dependencies /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=build --chown=appuser:appuser /app .

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health', timeout=5)"

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]