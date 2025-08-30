// frontend/src/hooks/useAuth.ts
import { useState, useEffect, useCallback } from 'react';
import { apiService, UserInfo } from '../services/api';

interface UseAuthReturn {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuth = (): UseAuthReturn => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const verifyToken = useCallback(async () => {
    if (!apiService.isAuthenticated()) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await apiService.verifyToken();
      if (response.data) {
        setUser(response.data);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.warn('Token verification failed:', err);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiService.login(username, password);
      
      if (response.data) {
        // Verify the new token and get user info
        await verifyToken();
      } else {
        setError(response.error || 'Login failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  }, [verifyToken]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    
    try {
      await apiService.logout();
    } catch (err) {
      console.warn('Logout error:', err);
    } finally {
      setUser(null);
      setIsLoading(false);
    }
  }, []);

  // Verify token on mount
  useEffect(() => {
    verifyToken();
  }, [verifyToken]);

  return {
    user,
    isAuthenticated: !!user,
    isLoading,
    error,
    login,
    logout,
    clearError,
  };
};
