# security-service/Dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.12-slim AS base

WORKDIR /app

# Install dependencies with cache
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip

FROM base AS dependencies

# Copy requirements and install (cache pip downloads and ensure build tools present)
COPY security-service/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

FROM dependencies AS runtime
LABEL org.opencontainers.image.title="Security Service"
LABEL org.opencontainers.image.description="Data exfiltration prevention and threat detection"

# Create non-root user
RUN adduser --disabled-password --gecos '' securityuser

# Copy source code
COPY --chown=securityuser:securityuser security-service/src/ src/

USER securityuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8005/health', timeout=3)"

EXPOSE 8005

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8005"]