#!/bin/bash

# Build script for Elasticsearch AI Chat Application
set -e

echo "🚀 Building Elasticsearch AI Chat Application..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p static

# Copy frontend file
echo "📋 Copying frontend files..."
if [ -f "index.html" ]; then
    cp index.html static/
else
    echo "⚠️  index.html not found, creating placeholder..."
    echo "<!DOCTYPE html><html><body><h1>Frontend placeholder</h1></body></html>" > static/index.html
fi

# Build Docker image
echo "🐳 Building Docker image..."
docker build -t elasticsearch-ai-chat:latest .

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Creating from template..."
    cp .env.example .env
    echo "📝 Please edit .env with your actual API keys and configuration"
fi

echo "✅ Build completed successfully!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your API keys"
echo "2. Run: docker-compose up -d"
echo "3. Access the application at http://localhost:8000"
echo ""
echo "Services that will be available:"
echo "- Application: http://localhost:8000"
echo "- Elasticsearch: http://localhost:9200"
echo "- Kibana: http://localhost:5601"
echo "- Jaeger UI: http://localhost:16686"
