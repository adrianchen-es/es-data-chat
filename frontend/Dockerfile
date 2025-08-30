# frontend/Dockerfile
# syntax=docker/dockerfile:1.6
FROM node:18-alpine AS dependencies

# Enable BuildKit cache mounts and optimization
WORKDIR /app

# Install dependencies with cache mount
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=bind,source=package.json,target=package.json \
    npm install --production && npm cache clean --force

FROM dependencies AS build
WORKDIR /app

# Copy source with optimal layering
COPY package*.json ./
COPY tsconfig.json ./
COPY tailwind.config.js ./
COPY postcss.config.js ./

# Install all dependencies including dev
RUN --mount=type=cache,target=/root/.npm \
    npm install

# Copy source code
COPY src/ src/
COPY public/ public/

# Build with cache mount for faster rebuilds
RUN --mount=type=cache,target=/app/.next/cache \
    --mount=type=cache,target=/app/node_modules/.cache \
    npm run build

FROM nginx:alpine AS runtime
##FROM cgr.dev/chainguard/nginx:latest AS runtime
LABEL org.opencontainers.image.title="AI Chat Frontend"
LABEL org.opencontainers.image.description="React TypeScript frontend with optimized build"

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Optimized nginx config
COPY --from=build --chown=nodejs:nodejs /app/build /usr/share/nginx/html

# Custom nginx configuration for SPA
RUN echo 'server { \
    listen 8080; \
    http2 on; \
    server_name _; \
    server_tokens off; \
    location / { \
        root /usr/share/nginx/html; \
        try_files $uri $uri/ /index.html; \
        add_header Cache-Control "no-cache, no-store, must-revalidate"; \
    } \
    location /static/ { \
        root /usr/share/nginx/html; \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Fix permissions for nginx cache directories
RUN mkdir -p /var/cache/nginx/client_temp \
             /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp \
             /var/cache/nginx/uwsgi_temp \
             /var/cache/nginx/scgi_temp \
             /run && \
    chown -R nodejs:nodejs /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /run

USER nodejs
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]