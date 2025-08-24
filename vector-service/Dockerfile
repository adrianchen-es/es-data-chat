# vector-service/Dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS base

# System dependencies
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /app

# Python dependencies with cache
RUN --mount=type=cache,target=/root/.cache/pip \
    --mount=type=bind,source=requirements.txt,target=requirements.txt \
    pip install --upgrade pip && \
    pip install -r requirements.txt

FROM dependencies AS build
WORKDIR /app

# Copy source code
COPY src/ src/

FROM python:3.11-slim AS runtime
LABEL org.opencontainers.image.title="Vector Database Service"
LABEL org.opencontainers.image.description="Qdrant vector database service for semantic caching"

WORKDIR /app

# Create non-root user
RUN adduser --disabled-password --gecos '' vectoruser

# Copy dependencies and source
COPY --from=dependencies /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=build --chown=vectoruser:vectoruser /app .

USER vectoruser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8004/health', timeout=5)"

EXPOSE 8004

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8004"]