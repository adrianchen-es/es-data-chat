# Minimal bff-service Dockerfile for local builds
FROM node:18-alpine AS build
WORKDIR /app

# Copy package.json and install dependencies (use npm install to avoid requiring package-lock.json)
COPY bff-service/package.json ./
RUN npm install --silent --no-audit --progress=false

# Copy source after deps
COPY bff-service/src/ src/
RUN npm run build
EXPOSE 3001
CMD ["node", "src/index.js"]
