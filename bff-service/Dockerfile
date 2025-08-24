# Minimal bff-service Dockerfile for local builds
FROM node:18-alpine AS build
WORKDIR /app

# Copy package files first to leverage npm cache
COPY bff-service/package.json bff-service/package-lock.json ./
RUN npm ci --silent --no-audit --progress=false

# Copy source after deps
COPY bff-service/src/ src/
RUN npm run build
EXPOSE 3001
CMD ["node", "src/index.js"]
