// frontend/src/telemetry/otel.ts
// Modern OpenTelemetry Web SDK setup with fallback

import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { trace, Span } from '@opentelemetry/api';

// Try to import Resource, fall back to simple object if not available
let Resource: any;
try {
  const resourceModule = require('@opentelemetry/resources');
  Resource = resourceModule.Resource;
} catch (error) {
  console.warn('Resource not available, using fallback');
  Resource = null;
}

// Configuration
const isProduction = process.env.NODE_ENV === 'production';
const serviceName = 'ai-chat-frontend';
const serviceVersion = '0.1.0';
const collectorEndpoint = process.env.REACT_APP_OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

// Resource configuration
const resourceAttributes = {
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: serviceVersion,
  'service.namespace': 'ai-chat',
  'deployment.environment': process.env.NODE_ENV || 'development',
};

let resource: any = null;
if (Resource) {
  try {
    resource = new Resource(resourceAttributes);
  } catch (error) {
    console.warn('Failed to create Resource, using attributes directly:', error);
  }
}

// Initialize OpenTelemetry
let provider: WebTracerProvider | null = null;
let isInitialized = false;

try {
  // Create provider
  const providerConfig: any = {};
  if (resource) {
    providerConfig.resource = resource;
  }
  
  provider = new WebTracerProvider(providerConfig);

  // Configure trace exporter
  const traceExporter = new OTLPTraceExporter({
    url: `${collectorEndpoint}/v1/traces`,
    headers: {},
  });

  // Add span processor
  const spanProcessor = new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 1000,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 500,
    exportTimeoutMillis: 30000,
  });

  // Configure span processor
  try {
    // Get the trace provider and add processor after registration
    const registeredProvider = trace.getTracerProvider() as any;
    if (registeredProvider && typeof registeredProvider.addSpanProcessor === 'function') {
      registeredProvider.addSpanProcessor(spanProcessor);
    }
  } catch (error) {
    console.warn('Failed to add span processor:', error);
  }

  // Register the provider
  provider.register();

  // Register instrumentations
  registerInstrumentations({
    instrumentations: getWebAutoInstrumentations({
      '@opentelemetry/instrumentation-fetch': {
        propagateTraceHeaderCorsUrls: [
          /^http:\/\/localhost:3001\/.*/,
          /^http:\/\/localhost:8000\/.*/,
        ],
        clearTimingResources: true,
      },
      '@opentelemetry/instrumentation-user-interaction': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-document-load': {
        enabled: true,
      },
    }),
  });

  isInitialized = true;
  console.log('OpenTelemetry WebSDK initialized successfully');
} catch (error) {
  console.warn('Failed to initialize OpenTelemetry WebSDK, falling back to simple telemetry:', error);
}

// Get tracer instance
const otelTracer = trace.getTracer(serviceName, serviceVersion);

// Enhanced telemetry interface with OpenTelemetry integration
interface TelemetryEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, any>;
  duration?: number;
}

class ModernTelemetry {
  private events: TelemetryEvent[] = [];
  private serviceName = serviceName;
  private serviceVersion = serviceVersion;

  // Create a span with automatic instrumentation
  public createSpan(name: string, attributes?: Record<string, any>) {
    let span: Span | null = null;
    let startTime = performance.now();

    try {
      if (isInitialized) {
        span = otelTracer.startSpan(name, {
          attributes: {
            'component': 'frontend',
            ...resourceAttributes,
            ...attributes,
          },
        });
      }
    } catch (error) {
      console.warn('Failed to create OpenTelemetry span, using fallback:', error);
    }

    const event: TelemetryEvent = {
      name,
      timestamp: Date.now(),
      attributes: {
        service: this.serviceName,
        version: this.serviceVersion,
        component: 'frontend',
        ...attributes,
      },
    };

    return {
      end: () => {
        const duration = performance.now() - startTime;
        event.duration = duration;
        
        try {
          if (span) {
            span.setAttributes({ 'duration.ms': duration });
            span.end();
          }
        } catch (error) {
          console.warn('Failed to end OpenTelemetry span:', error);
        }
        
        this.sendTelemetry(event);
      },
      setAttributes: (attrs: Record<string, any>) => {
        event.attributes = { ...event.attributes, ...attrs };
        try {
          if (span) {
            span.setAttributes(attrs);
          }
        } catch (error) {
          console.warn('Failed to set span attributes:', error);
        }
      },
      recordException: (error: Error) => {
        const errorAttrs = {
          error: true,
          'error.name': error.name,
          'error.message': error.message,
          'error.stack': error.stack,
        };
        event.attributes = { ...event.attributes, ...errorAttrs };
        
        try {
          if (span) {
            span.recordException(error);
            span.setStatus({ code: 2, message: error.message }); // ERROR status
          }
        } catch (e) {
          console.warn('Failed to record exception in span:', e);
        }
      },
    };
  }

  public trackUserAction(actionName: string, attributes?: Record<string, any>) {
    const span = this.createSpan(`user_action.${actionName}`, {
      'user.action': actionName,
      'interaction.type': 'user_interaction',
      ...attributes,
    });
    span.end();
  }

  public async measureApiCall<T>(
    endpoint: string,
    method: string,
    apiCall: () => Promise<T>
  ): Promise<T> {
    const span = this.createSpan(`api_call.${method.toLowerCase()}_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`, {
      'http.method': method,
      'http.url': endpoint,
      'component': 'http_client',
    });

    try {
      const result = await apiCall();
      span.setAttributes({
        'http.status_code': 200,
        'operation.success': true,
      });
      return result;
    } catch (error: any) {
      span.setAttributes({
        'http.status_code': error.status || 500,
        'operation.success': false,
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  }

  private async sendTelemetry(event: TelemetryEvent) {
    try {
      // Log for debugging
      if (!isProduction) {
        console.log(`[TELEMETRY] ${event.name}`, event);
      }
      
      // Store locally for debugging
      this.events.push(event);
      
      // Keep only last 100 events to prevent memory leaks
      if (this.events.length > 100) {
        this.events = this.events.slice(-100);
      }
      
      // Future: Send to backend telemetry endpoint if needed
      // await fetch('/api/telemetry', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(event)
      // });
    } catch (error) {
      console.warn('Failed to send telemetry:', error);
    }
  }

  public getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  public clearEvents() {
    this.events = [];
  }

  // Shutdown telemetry
  public async shutdown() {
    try {
      if (provider && typeof provider.shutdown === 'function') {
        await provider.shutdown();
      }
    } catch (error) {
      console.warn('Failed to shutdown OpenTelemetry SDK:', error);
    }
  }
}

// Export singleton instance
export const telemetry = new ModernTelemetry();

// Compatibility exports for existing code
export const tracer = {
  startSpan: (name: string, attributes?: Record<string, any>) => 
    telemetry.createSpan(name, attributes),
};

export const createSpan = (name: string, attributes?: Record<string, any>) =>
  telemetry.createSpan(name, attributes);

export const performanceObserver = {
  measureUserAction: (actionName: string, callback: () => void | Promise<void>) => {
    telemetry.trackUserAction(actionName);
    return callback();
  },
  measureApiCall: telemetry.measureApiCall.bind(telemetry),
};

// Global error tracking with OpenTelemetry
if (typeof window !== 'undefined') {
  // Track page load with more detailed attributes
  window.addEventListener('load', () => {
    telemetry.trackUserAction('page_load', {
      'navigation.type': 'load',
      'page.url': window.location.href,
      'page.title': document.title,
      'user_agent': navigator.userAgent,
      'viewport.width': window.innerWidth,
      'viewport.height': window.innerHeight,
    });
  });

  // Track navigation
  window.addEventListener('beforeunload', () => {
    telemetry.trackUserAction('page_unload');
  });

  // Track JavaScript errors
  window.addEventListener('error', (event) => {
    const span = telemetry.createSpan('javascript_error', {
      'error.type': 'javascript_error',
      'error.filename': event.filename,
      'error.lineno': event.lineno,
      'error.colno': event.colno,
    });
    span.recordException(event.error || new Error(event.message));
    span.end();
  });

  // Track unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const span = telemetry.createSpan('unhandled_promise_rejection', {
      'error.type': 'unhandled_promise_rejection',
    });
    span.recordException(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
    span.end();
  });

  // Track performance metrics
  if ('performance' in window && 'getEntriesByType' in window.performance) {
    window.addEventListener('load', () => {
      setTimeout(() => {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        if (navigation) {
          telemetry.trackUserAction('performance_navigation', {
            'navigation.dom_content_loaded': navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
            'navigation.load_complete': navigation.loadEventEnd - navigation.loadEventStart,
            'navigation.dns_lookup': navigation.domainLookupEnd - navigation.domainLookupStart,
            'navigation.tcp_connect': navigation.connectEnd - navigation.connectStart,
            'navigation.request_response': navigation.responseEnd - navigation.requestStart,
          });
        }
      }, 1000);
    });
  }

  // Graceful shutdown on page unload
  window.addEventListener('beforeunload', () => {
    telemetry.shutdown();
  });
}

console.log('Modern OpenTelemetry instrumentation initialized for ai-chat-frontend');
