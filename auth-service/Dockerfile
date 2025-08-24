# auth-service/Dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS base

WORKDIR /app

# System dependencies for cryptography
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

# Copy requirements first to maximize cache reuse
COPY auth-service/requirements.txt ./

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

FROM dependencies AS build
WORKDIR /app

# Copy source after installing dependencies
COPY auth-service/src/ src/

FROM python:3.11-alpine AS runtime
LABEL org.opencontainers.image.title="Authentication Service"
LABEL org.opencontainers.image.description="Keycloak JWT authentication service"

WORKDIR /app

# Create non-root user
RUN adduser --disabled-password --gecos '' authuser

# Copy dependencies and source
COPY --from=dependencies /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=build --chown=authuser:authuser /app .

USER authuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8003/health', timeout=5)"

EXPOSE 8003

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8003"]