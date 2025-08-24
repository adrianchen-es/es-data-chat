// bff-service/src/index.js
const fastify = require('fastify')({ 
  logger: {
    redact: ['req.headers.authorization', 'req.body.password', 'email', 'phone'],
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        headers: {
          ...req.headers,
          authorization: req.headers.authorization ? '[REDACTED]' : undefined
        }
      })
    }
  }
});
const axios = require('axios');

// OpenTelemetry (pinned versions)
const { NodeTracerProvider } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');

const provider = new NodeTracerProvider({
  instrumentations: [getNodeAutoInstrumentations()]
});

// Configure OTLP exporter (endpoint via OTEL_EXPORTER_OTLP_ENDPOINT)
const otlpExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || undefined
});

provider.addSpanProcessor(new (require('@opentelemetry/sdk-node').SimpleSpanProcessor)(otlpExporter));
provider.register();

// Graceful shutdown: flush provider on SIGTERM/SIGINT
async function shutdownTracing() {
  try {
    await provider.shutdown();
  } catch (err) {
    fastify.log.error('Error shutting down OTEL provider', err);
  }
}
process.on('SIGTERM', shutdownTracing);
process.on('SIGINT', shutdownTracing);

// Services
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:8003';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:8000';
const DOC_SERVICE_URL = process.env.DOC_SERVICE_URL || 'http://document-service:8001';

// Rate limiting store
const rateLimitStore = new Map();

// Rate limiting middleware
const rateLimit = {
  windowMs: 60 * 1000, // 1 minute
  max: 100, // requests per window
  message: { error: 'Too many requests, please try again later' }
};

fastify.register(require('@fastify/rate-limit'), {
  max: rateLimit.max,
  timeWindow: rateLimit.windowMs,
  keyGenerator: (req) => req.ip || 'anonymous',
  errorResponseBuilder: () => rateLimit.message
});

// CORS
fastify.register(require('@fastify/cors'), { 
  origin: true,
  credentials: true 
});

// Input validation schemas
const chatRequestSchema = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { 
      type: 'string', 
      minLength: 1, 
      maxLength: 2000,
      pattern: '^[\\s\\S]*$' // Allow all characters but with length limits
    },
    context: { 
      type: 'string', 
      maxLength: 5000 
    },
    conversation_id: {
      type: 'string',
      pattern: '^[a-fA-F0-9-]{36}$' // UUID format
    }
  },
  additionalProperties: false
};

// Auth middleware
async function authenticateRequest(request, reply) {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid authorization header' });
    return;
  }
  
  try {
    const token = authHeader.split(' ')[1];
    const response = await axios.get(`${AUTH_SERVICE_URL}/verify`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    request.user = response.data;
  } catch (error) {
    reply.code(401).send({ error: 'Invalid or expired token' });
  }
}

// Health endpoint (no auth required)
fastify.get('/api/health', async (request, reply) => {
  const services = {};
  
  const healthChecks = [
    { name: 'auth', url: `${AUTH_SERVICE_URL}/health` },
    { name: 'ai', url: `${AI_SERVICE_URL}/health` },
    { name: 'documents', url: `${DOC_SERVICE_URL}/health` }
  ];
  
  await Promise.allSettled(
    healthChecks.map(async ({ name, url }) => {
      try {
        await axios.get(url, { timeout: 3000 });
        services[name] = true;
      } catch {
        services[name] = false;
      }
    })
  );
  
  const allHealthy = Object.values(services).every(Boolean);
  
  reply.send({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: { ...services, api: true }
  });
});

// Chat endpoint with validation and auth
fastify.post('/api/chat', {
  preHandler: authenticateRequest,
  schema: { body: chatRequestSchema }
}, async (request, reply) => {
  try {
    const response = await axios.post(`${AI_SERVICE_URL}/chat`, {
      ...request.body,
      user_id: request.user.user_id
    }, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    });
    
    // Log successful chat request (without message content)
    fastify.log.info({
      event: 'chat_request',
      user_id: request.user.user_id,
      conversation_id: request.body.conversation_id,
      response_time: response.headers['x-response-time']
    });
    
    reply.send(response.data);
  } catch (error) {
    fastify.log.error({
      event: 'chat_error',
      user_id: request.user.user_id,
      error: error.response?.data || error.message
    });
    
    reply.code(error.response?.status || 500).send({
      error: error.response?.data?.detail || 'Internal server error'
    });
  }
});

// Streaming endpoint
fastify.get('/api/chat/stream', {
  preHandler: authenticateRequest
}, async (request, reply) => {
  try {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    
    const streamResponse = await axios.get(`${AI_SERVICE_URL}/stream`, {
      params: { 
        message: request.query.message,
        user_id: request.user.user_id,
        conversation_id: request.query.conversation_id
      },
      responseType: 'stream',
      timeout: 60000
    });
    
    streamResponse.data.pipe(reply.raw);
    
  } catch (error) {
    const errorData = JSON.stringify({ 
      error: error.response?.data || error.message,
      finished: true 
    });
    reply.raw.write(`data: ${errorData}\n\n`);
    reply.raw.end();
  }
});

// File upload with enhanced validation
fastify.register(require('@fastify/multipart'), {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 1
  }
});

fastify.post('/api/documents/upload', {
  preHandler: authenticateRequest
}, async (request, reply) => {
  try {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file provided' });
    }
    
    // File validation
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];
    
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.code(400).send({ error: 'File type not allowed' });
    }
    
    const formData = new FormData();
    formData.append('file', data.file, data.filename);
    
    const uploadResponse = await axios.post(`${DOC_SERVICE_URL}/documents/upload`, formData, {
      headers: { 
        'Content-Type': 'multipart/form-data',
        'X-User-ID': request.user.user_id
      },
      timeout: 120000 // 2 minutes for large files
    });
    
    fastify.log.info({
      event: 'document_upload',
      user_id: request.user.user_id,
      filename: data.filename,
      size: data.file.bytesRead,
      document_id: uploadResponse.data.document_id
    });
    
    reply.send(uploadResponse.data);
    
  } catch (error) {
    fastify.log.error({
      event: 'upload_error',
      user_id: request.user?.user_id,
      error: error.message
    });
    
    reply.code(error.response?.status || 500).send({
      error: error.response?.data?.detail || 'Upload failed'
    });
  }
});

// Conversation management
fastify.get('/api/conversations', {
  preHandler: authenticateRequest
}, async (request, reply) => {
  try {
    const response = await axios.get(`${AI_SERVICE_URL}/conversations`, {
      params: { user_id: request.user.user_id },
      headers: { 'Content-Type': 'application/json' }
    });
    
    reply.send(response.data);
  } catch (error) {
    reply.code(500).send({ error: 'Failed to fetch conversations' });
  }
});

// Error handler with PII redaction
fastify.setErrorHandler((error, request, reply) => {
  const sanitizedError = {
    message: error.message,
    statusCode: error.statusCode || 500,
    timestamp: new Date().toISOString()
  };
  
  // Don't log sensitive request data
  fastify.log.error({
    event: 'request_error',
    error: sanitizedError,
    url: request.url,
    method: request.method,
    user_id: request.user?.user_id
  });
  
  reply.code(sanitizedError.statusCode).send({
    error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  try {
    await fastify.close();
    process.exit(0);
  } catch (err) {
    fastify.log.error('Error during shutdown', err);
    process.exit(1);
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' });
    console.log('🚀 BFF Service running on port 3001 with enhanced security');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();