# security-service/Dockerfile
# syntax=docker/dockerfile:1.6
FROM python:3.12-alpine AS base

WORKDIR /app

# Install dependencies with cache
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip

FROM base AS dependencies

RUN apk add --no-cache py3-pip py3-setuptools py3-wheel

# Copy requirements and install (cache pip downloads and ensure build tools present)
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

FROM python:3.12-alpine AS runtime
COPY --from=dependencies /usr/local/bin /usr/local/bin
LABEL org.opencontainers.image.title="Security Service"
LABEL org.opencontainers.image.description="Data exfiltration prevention and threat detection"

# Create non-root user
RUN adduser --disabled-password --gecos '' securityuser

# Copy source code
COPY --chown=securityuser:securityuser src/ src/

USER securityuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8005/health', timeout=3)"

EXPOSE 8005

# Entrypoint: prefer gunicorn with uvicorn workers if available, otherwise use uvicorn module
COPY --chown=docuser:docuser --chmod=755 <<'EOF' /usr/local/bin/entrypoint.sh
#!/bin/sh
set -e

# Allow overriding the ASGI app module via APP_MODULE env var
APP_MODULE=${APP_MODULE:-src.main:app}

if python - <<'PY' 2>/dev/null
import importlib,sys
try:
    importlib.util.find_spec('gunicorn')
    sys.exit(0)
except Exception:
    sys.exit(1)
PY
then
    exec python -m gunicorn -k uvicorn.workers.UvicornWorker "$APP_MODULE" -b 0.0.0.0:8005 --workers ${WORKERS:-2}
else
    # Fallback to running uvicorn directly via python -m to ensure the module path works
    exec python -m uvicorn "$APP_MODULE" --host 0.0.0.0 --port 8005
fi
EOF

CMD ["/usr/local/bin/entrypoint.sh"]