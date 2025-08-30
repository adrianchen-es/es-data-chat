// frontend/src/telemetry/otel.ts
// Simplified OpenTelemetry setup for frontend

// Basic telemetry interface without complex dependencies
interface TelemetryEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, any>;
  duration?: number;
}

class SimpleTelemetry {
  private events: TelemetryEvent[] = [];
  private serviceName = 'ai-chat-frontend';
  private serviceVersion = '0.1.0';

  // Send telemetry to backend when available
  private async sendTelemetry(event: TelemetryEvent) {
    try {
      // In production, this would send to OTEL collector
      console.log(`[TELEMETRY] ${event.name}`, event);
      
      // Store locally for debugging
      this.events.push(event);
      
      // Keep only last 100 events to prevent memory leaks
      if (this.events.length > 100) {
        this.events = this.events.slice(-100);
      }
      
      // Future: Send to backend telemetry endpoint
      // await fetch('/api/telemetry', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(event)
      // });
    } catch (error) {
      console.warn('Failed to send telemetry:', error);
    }
  }

  public createSpan(name: string, attributes?: Record<string, any>) {
    const startTime = performance.now();
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
        event.duration = performance.now() - startTime;
        this.sendTelemetry(event);
      },
      setAttributes: (attrs: Record<string, any>) => {
        event.attributes = { ...event.attributes, ...attrs };
      },
      recordException: (error: Error) => {
        event.attributes = {
          ...event.attributes,
          error: true,
          'error.name': error.name,
          'error.message': error.message,
          'error.stack': error.stack,
        };
      },
    };
  }

  public trackUserAction(actionName: string, attributes?: Record<string, any>) {
    const span = this.createSpan(`user_action.${actionName}`, {
      'user.action': actionName,
      'interaction.type': 'click',
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

  public getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  public clearEvents() {
    this.events = [];
  }
}

// Export singleton instance
export const telemetry = new SimpleTelemetry();

// Compatibility exports for future OpenTelemetry integration
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

// Initialize basic performance monitoring
if (typeof window !== 'undefined') {
  // Track page load
  window.addEventListener('load', () => {
    telemetry.trackUserAction('page_load', {
      'navigation.type': 'load',
      'page.url': window.location.href,
    });
  });

  // Track navigation
  window.addEventListener('beforeunload', () => {
    telemetry.trackUserAction('page_unload');
  });

  // Track errors
  window.addEventListener('error', (event) => {
    const span = telemetry.createSpan('javascript_error');
    span.recordException(event.error || new Error(event.message));
    span.end();
  });

  // Track unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const span = telemetry.createSpan('unhandled_promise_rejection');
    span.recordException(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
    span.end();
  });
}

console.log('Simplified telemetry initialized for ai-chat-frontend');
