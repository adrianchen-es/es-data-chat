// frontend/src/services/api.ts
import { telemetry } from '../telemetry/otel';

export interface ApiResponse<T = any> {
  data?: T | null;
  error?: string;
  status: number;
}

export interface Message {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: Date;
  isStreaming?: boolean;
  metadata?: {
    model?: string;
    confidence?: number;
    sources?: string[];
    processingTime?: number;
  };
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    api: boolean;
    ai: boolean;
    auth: boolean;
    documents: boolean;
  };
  timestamp: string;
}

export interface SystemMetrics {
  totalMessages: number;
  averageResponseTime: number;
  cacheHitRate: number;
  uptime: string;
}

export interface ChatRequest {
  message: string;
  context?: string;
  conversation_id?: string;
}

export interface ChatResponse {
  response: string;
  conversation_id: string;
  metadata?: {
    model?: string;
    confidence?: number;
    sources?: string[];
    processing_time?: number;
    cached?: boolean;
  };
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface UserInfo {
  user_id: string;
  username: string;
  email?: string;
  roles?: string[];
}

export interface DocumentUploadResponse {
  document_id: string;
  filename: string;
  status: string;
  processing_started: boolean;
}

export interface ModelInfo {
  name: string;
  healthy: boolean;
  costs: {
    input?: number;
    output?: number;
  };
  provider: string;
}

export interface Conversation {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

class ApiService {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
    this.loadAuthToken();
  }

  private loadAuthToken() {
    this.authToken = localStorage.getItem('auth_token');
  }

  private saveAuthToken(token: string) {
    this.authToken = token;
    localStorage.setItem('auth_token', token);
  }

  private clearAuthToken() {
    this.authToken = null;
    localStorage.removeItem('auth_token');
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    return telemetry.measureApiCall(url, options.method || 'GET', async () => {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            ...this.getHeaders(),
            ...options.headers,
          },
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          // Handle authentication errors
          if (response.status === 401) {
            this.clearAuthToken();
          }

          return {
            data: null,
            error: data?.error || `HTTP ${response.status}`,
            status: response.status,
          };
        }

        return {
          data,
          status: response.status,
        };
      } catch (error) {
        return {
          data: null,
          error: error instanceof Error ? error.message : 'Network error',
          status: 0,
        };
      }
    });
  }

  // Health and System Status
  async getHealth(): Promise<ApiResponse<HealthStatus>> {
    return this.request<HealthStatus>('/api/health');
  }

  // Authentication
  async login(username: string, password: string): Promise<ApiResponse<AuthTokens>> {
    const response = await this.request<AuthTokens>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (response.data?.access_token) {
      this.saveAuthToken(response.data.access_token);
    }

    return response;
  }

  async logout(): Promise<ApiResponse<void>> {
    const response = await this.request<void>('/api/auth/logout', {
      method: 'POST',
    });

    this.clearAuthToken();
    return response;
  }

  async refreshToken(): Promise<ApiResponse<AuthTokens>> {
    const response = await this.request<AuthTokens>('/api/auth/refresh', {
      method: 'POST',
    });

    if (response.data?.access_token) {
      this.saveAuthToken(response.data.access_token);
    }

    return response;
  }

  async verifyToken(): Promise<ApiResponse<UserInfo>> {
    return this.request<UserInfo>('/api/auth/verify');
  }

  // Chat functionality
  async sendMessage(request: ChatRequest): Promise<ApiResponse<ChatResponse>> {
    return this.request<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Streaming chat
  async startChatStream(
    message: string,
    conversation_id?: string,
    onMessage?: (content: string) => void,
    onComplete?: (response: ChatResponse) => void,
    onError?: (error: string) => void
  ): Promise<void> {
    if (!this.authToken) {
      onError?.('Authentication required');
      return;
    }

    const params = new URLSearchParams({
      message,
      ...(conversation_id && { conversation_id }),
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/chat/stream?${params}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                onMessage?.(data.content);
              } else if (data.finished) {
                onComplete?.(data);
                return;
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', line);
            }
          }
        }
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Stream error');
    }
  }

  // Document management
  async uploadDocument(file: File): Promise<ApiResponse<DocumentUploadResponse>> {
    const formData = new FormData();
    formData.append('file', file);

    return telemetry.measureApiCall('/api/documents/upload', 'POST', async () => {
      try {
        const response = await fetch(`${this.baseUrl}/api/documents/upload`, {
          method: 'POST',
          headers: {
            'Authorization': this.authToken ? `Bearer ${this.authToken}` : '',
          },
          body: formData,
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          return {
            data: null,
            error: data?.error || `HTTP ${response.status}`,
            status: response.status,
          };
        }

        return {
          data,
          status: response.status,
        };
      } catch (error) {
        return {
          data: null,
          error: error instanceof Error ? error.message : 'Upload error',
          status: 0,
        };
      }
    });
  }

  // Conversations
  async getConversations(): Promise<ApiResponse<Conversation[]>> {
    return this.request<Conversation[]>('/api/conversations');
  }

  // AI Models
  async getModels(): Promise<ApiResponse<{ models: ModelInfo[]; fallback_chain: string[] }>> {
    return this.request('/api/ai/models');
  }

  // Security status
  async getSecurityStatus(): Promise<ApiResponse<any>> {
    return this.request('/api/security/status');
  }

  // Cache metrics
  async getCacheMetrics(): Promise<ApiResponse<SystemMetrics>> {
    return this.request('/api/cache/metrics');
  }

  // Utility methods
  isAuthenticated(): boolean {
    return !!this.authToken;
  }

  setAuthToken(token: string) {
    this.saveAuthToken(token);
  }
}

export const apiService = new ApiService();
