#!/usr/bin/env bash
# Simple smoke tests for ai-service
set -euo pipefail

AI_HOST=${AI_HOST:-http://localhost:8000}

echo "Checking AI service health at ${AI_HOST}/health"
curl -fsS "${AI_HOST}/health" >/dev/null
echo "Health OK"

# Try a lightweight API call. The repo README suggests a /models endpoint is available for testing.
if curl --fail --silent --show-error "${AI_HOST}/models" -o /tmp/ai_models.json; then
  echo "/models endpoint OK — sample output saved to /tmp/ai_models.json"
else
  echo "Warning: /models endpoint not available or returned error. Skipping detailed model check." >&2
fi

echo "AI smoke tests complete."
