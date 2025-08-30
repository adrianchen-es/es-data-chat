// frontend/src/services/__tests__/api.test.ts
import { apiService } from '../api';

// Mock fetch
global.fetch = jest.fn();

describe('API Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('Authentication', () => {
    it('should save token after successful login', async () => {
      const mockResponse = {
        access_token: 'test-token',
        expires_in: 3600,
        token_type: 'Bearer'
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await apiService.login('testuser', 'password123');
      
      expect(result.status).toBe(200);
      expect(result.data).toEqual(mockResponse);
      expect(localStorage.getItem('auth_token')).toBe('test-token');
    });

    it('should include auth header in authenticated requests', async () => {
      apiService.setAuthToken('test-token');

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ user_id: '123', username: 'testuser' }),
      });

      await apiService.verifyToken();

      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/verify',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      );
    });

    it('should clear token on logout', async () => {
      apiService.setAuthToken('test-token');
      
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await apiService.logout();
      
      expect(localStorage.getItem('auth_token')).toBeNull();
    });
  });

  describe('Chat', () => {
    it('should send chat message with conversation ID', async () => {
      apiService.setAuthToken('test-token');
      
      const mockResponse = {
        response: 'Test response',
        conversation_id: 'conv-123',
        metadata: { model: 'gpt-4o' }
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await apiService.sendMessage({
        message: 'Test message',
        conversation_id: 'conv-123'
      });

      expect(result.status).toBe(200);
      expect(result.data).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        '/api/chat',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            message: 'Test message',
            conversation_id: 'conv-123'
          })
        })
      );
    });
  });

  describe('Health Check', () => {
    it('should fetch health status', async () => {
      const mockHealth = {
        status: 'healthy',
        services: { api: true, ai: true, auth: true, documents: true },
        timestamp: '2024-01-01T00:00:00Z'
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHealth),
      });

      const result = await apiService.getHealth();

      expect(result.status).toBe(200);
      expect(result.data).toEqual(mockHealth);
      expect(fetch).toHaveBeenCalledWith('/api/health', expect.any(Object));
    });
  });

  describe('Error Handling', () => {
    it('should handle 401 errors by clearing token', async () => {
      apiService.setAuthToken('invalid-token');

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      });

      const result = await apiService.verifyToken();

      expect(result.status).toBe(401);
      expect(result.error).toBe('Unauthorized');
      expect(localStorage.getItem('auth_token')).toBeNull();
    });

    it('should handle network errors', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await apiService.getHealth();

      expect(result.status).toBe(0);
      expect(result.error).toBe('Network error');
    });
  });
});
