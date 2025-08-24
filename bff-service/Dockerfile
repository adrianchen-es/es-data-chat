# Minimal bff-service Dockerfile for local builds
FROM node:18-alpine AS build
WORKDIR /app

# Copy package files and use npm ci for deterministic installs
COPY package.json ./
COPY package-lock.json ./

# Install dependencies with cache mount; use npm ci which respects package-lock.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --production --silent --no-audit --progress=false && npm cache clean --force

# Copy source after deps to maximize layer caching
COPY src/ src/
RUN npm run build
EXPOSE 3001
CMD ["node", "src/index.js"]
