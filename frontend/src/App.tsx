// frontend/src/App.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { 
  LoginForm, 
  Header, 
  Sidebar, 
  SecurityAlert, 
  DebugPanel, 
  WelcomeScreen, 
  MessageList, 
  MessageInput 
} from './components';
import { apiService, Message, HealthStatus, SystemMetrics, UserInfo } from './services/api';
import { telemetry } from './telemetry/otel';

const ChatApp: React.FC = () => {
  // Debug render tracking
  console.log('[DEBUG] ChatApp render');

  // Authentication state
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  // System state
  const initialHealthStatus = useMemo<HealthStatus>(() => ({
    status: 'healthy',
    services: { api: true, ai: true, auth: true, documents: true },
    timestamp: new Date().toISOString()
  }), []);
  
  const initialSystemMetrics = useMemo<SystemMetrics>(() => ({
    totalMessages: 0,
    averageResponseTime: 0,
    cacheHitRate: 85,
    uptime: '0m'
  }), []);

  const [healthStatus, setHealthStatus] = useState<HealthStatus>(initialHealthStatus);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>(initialSystemMetrics);
  
  // UI state
  const [showSidebar, setShowSidebar] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [securityAlert, setSecurityAlert] = useState<string>('');

  // Check authentication status on app load
  useEffect(() => {
    const checkAuth = async () => {
      if (apiService.isAuthenticated()) {
        try {
          const response = await apiService.verifyToken();
          if (response.data) {
            setUser(response.data);
            setIsAuthenticated(true);
            telemetry.trackUserAction('auth_verified', { user_id: response.data.user_id });
          } else {
            setIsAuthenticated(false);
          }
        } catch (error) {
          console.warn('Auth verification failed:', error);
          setIsAuthenticated(false);
        }
      }
      setAuthChecked(true);
    };

    checkAuth();
  }, []);

  // Load user preferences and chat history
  useEffect(() => {
    if (isAuthenticated) {
      telemetry.trackUserAction('app_load');
      
      const savedMessages = localStorage.getItem('chat-history');
      const savedDarkMode = localStorage.getItem('dark-mode') === 'true';
      
      if (savedMessages) {
        try {
          const parsedMessages = JSON.parse(savedMessages);
          setMessages(parsedMessages.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
          })));
        } catch (error) {
          console.warn('Failed to load chat history:', error);
        }
      }
      
      setDarkMode(savedDarkMode);
      
      // Apply dark mode class
      if (savedDarkMode) {
        document.documentElement.classList.add('dark');
      }
    }
  }, [isAuthenticated]);

  // Save chat history and preferences
  useEffect(() => {
    if (isAuthenticated) {
      localStorage.setItem('chat-history', JSON.stringify(messages));
      setSystemMetrics(prev => ({ 
        ...prev, 
        totalMessages: messages.filter(m => m.isUser).length 
      }));
    }
  }, [messages, isAuthenticated]);

  useEffect(() => {
    localStorage.setItem('dark-mode', darkMode.toString());
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Health check
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkHealth = async () => {
      try {
        const response = await apiService.getHealth();
        if (response.data) {
          setHealthStatus(response.data);
        }
      } catch (error) {
        console.warn('Health check failed:', error);
        setHealthStatus({
          status: 'unhealthy',
          services: { api: false, ai: false, auth: false, documents: false },
          timestamp: new Date().toISOString()
        });
      }
    };
    
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case 'd':
            e.preventDefault();
            setShowDebug(!showDebug);
            break;
        }
      }
      if (e.key === 'Escape') {
        setShowSidebar(false);
        setSecurityAlert('');
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [showDebug]);

  // Authentication handlers
  const handleLogin = async (username: string, password: string) => {
    try {
      telemetry.trackUserAction('login_attempt', { username });
      
      const response = await apiService.login(username, password);
      if (response.data) {
        // Verify the token and get user info
        const userResponse = await apiService.verifyToken();
        if (userResponse.data) {
          setUser(userResponse.data);
          setIsAuthenticated(true);
          telemetry.trackUserAction('login_success', { user_id: userResponse.data.user_id });
          return { success: true };
        }
      }
      
      telemetry.trackUserAction('login_failure', { error: response.error });
      return { success: false, error: response.error || 'Login failed' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      telemetry.trackUserAction('login_error', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  };

  const handleLogout = async () => {
    try {
      await apiService.logout();
      setUser(null);
      setIsAuthenticated(false);
      setMessages([]);
      setCurrentConversationId(null);
      localStorage.removeItem('chat-history');
      telemetry.trackUserAction('logout');
    } catch (error) {
      console.warn('Logout error:', error);
    }
  };

  // Message handling
  const simulateStreamingResponse = async (response: string, messageId: string) => {
    const words = response.split(' ');
    let currentContent = '';
    const delay = 30;
    
    for (let i = 0; i < words.length; i++) {
      currentContent += words[i] + ' ';
      await new Promise(resolve => setTimeout(resolve, delay));
      
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, content: currentContent.trim() }
          : msg
      ));
    }

    setMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { ...msg, isStreaming: false }
        : msg
    ));
  };

  const handleSendMessage = useCallback(async (message: string) => {
    if (!message.trim() || isLoading || !isAuthenticated) return;

    telemetry.trackUserAction('send_message', { messageLength: message.length });
    
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      content: message,
      isUser: true,
      timestamp: new Date()
    };

    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage: Message = {
      id: assistantMessageId,
      content: '',
      isUser: false,
      timestamp: new Date(),
      isStreaming: true
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setIsLoading(true);

    try {
      // Try real API first, fall back to mock if unavailable
      const response = await apiService.sendMessage({
        message,
        conversation_id: currentConversationId || undefined
      });

      if (response.data) {
        // Real API response
        setCurrentConversationId(response.data.conversation_id);
        
        const metadata = {
          model: response.data.metadata?.model || 'unknown',
          confidence: response.data.metadata?.confidence || 0.85,
          sources: response.data.metadata?.sources || [],
          processingTime: response.data.metadata?.processing_time || 1000
        };

        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, metadata, content: response.data!.response, isStreaming: false }
            : msg
        ));

        setSystemMetrics(prev => ({
          ...prev,
          averageResponseTime: Math.round((prev.averageResponseTime + (metadata.processingTime || 1000)) / 2)
        }));
      } else {
        // Fall back to mock response
        const mockResponses = [
          `I understand you're asking about "${message}". Based on my analysis of your data, I can provide several insights. This response demonstrates the streaming functionality and would normally connect to our AI service with RAG capabilities.`,
          `Great question about "${message}"! Let me search through your documents and provide a comprehensive answer. The system is designed to provide intelligent responses based on your specific data sources and context.`,
          `I've analyzed your query regarding "${message}". Here are the key findings from your document corpus: This would include relevant excerpts, citations, and actionable insights in a production environment.`,
        ];
        
        const mockResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
        
        const mockMetadata = {
          model: ['gpt-4o', 'claude-3', 'gpt-4-turbo'][Math.floor(Math.random() * 3)],
          confidence: 0.75 + Math.random() * 0.2,
          sources: ['document1.pdf', 'document2.docx', 'knowledge-base.md'].slice(0, Math.floor(Math.random() * 3) + 1),
          processingTime: 800 + Math.random() * 1200
        };

        // Update message with metadata
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, metadata: mockMetadata }
            : msg
        ));
        
        // Start streaming
        await simulateStreamingResponse(mockResponse, assistantMessageId);
        
        // Update metrics
        setSystemMetrics(prev => ({
          ...prev,
          averageResponseTime: Math.round((prev.averageResponseTime + mockMetadata.processingTime) / 2)
        }));
      }
      
      setSecurityAlert('');
    } catch (error: any) {
      console.error('Error sending message:', error);
      
      let errorMessage = 'Sorry, I encountered an error. Please try again.';
      
      if (error.status === 403) {
        setSecurityAlert('Your message was blocked by security filters. Please rephrase and try again.');
        errorMessage = 'Message blocked for security reasons.';
      } else if (error.status === 429) {
        setSecurityAlert('You are sending messages too quickly. Please wait a moment before trying again.');
        errorMessage = 'Rate limit exceeded. Please wait.';
      }
      
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessageId 
          ? { ...msg, content: errorMessage, isStreaming: false }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isAuthenticated, currentConversationId]);

  const handleFileUpload = async (file: File) => {
    if (!isAuthenticated) return;

    telemetry.trackUserAction('file_upload', { 
      fileName: file.name, 
      fileSize: file.size,
      fileType: file.type 
    });
    
    try {
      const response = await apiService.uploadDocument(file);
      
      if (response.data) {
        setMessages(prev => [...prev, {
          id: `file-${Date.now()}`,
          content: `📁 Uploaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)\n\nStatus: ${response.data!.status}\nDocument ID: ${response.data!.document_id}\n\nThe document is now being processed and will be available for queries soon.`,
          isUser: false,
          timestamp: new Date()
        }]);
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        id: `file-error-${Date.now()}`,
        content: `❌ Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease try again or contact support if the issue persists.`,
        isUser: false,
        timestamp: new Date()
      }]);
    }
  };

  // UI handlers
  const clearChat = () => {
    telemetry.trackUserAction('clear_chat');
    setMessages([]);
    setCurrentConversationId(null);
  };

  const toggleSidebar = () => {
    telemetry.trackUserAction('toggle_sidebar');
    setShowSidebar(!showSidebar);
  };

  // Show login form if not authenticated
  if (!authChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm onLogin={handleLogin} darkMode={darkMode} onToggleDarkMode={setDarkMode} />;
  }

  const themeClasses = darkMode ? 'dark bg-gray-900' : 'bg-gray-50';

  return (
    <div className={clsx('flex h-screen', themeClasses, { 'fixed inset-0 z-50': fullscreen })}>
      {/* Sidebar */}
      <Sidebar
        isOpen={showSidebar}
        healthStatus={healthStatus}
        systemMetrics={systemMetrics}
        darkMode={darkMode}
        onClose={() => setShowSidebar(false)}
        onClearChat={clearChat}
        onToggleDebug={() => setShowDebug(!showDebug)}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <Header
          user={user}
          isLoading={isLoading}
          healthStatus={healthStatus}
          showDebug={showDebug}
          fullscreen={fullscreen}
          darkMode={darkMode}
          onToggleSidebar={toggleSidebar}
          onToggleDebug={() => setShowDebug(!showDebug)}
          onToggleFullscreen={() => setFullscreen(!fullscreen)}
          onLogout={handleLogout}
        />

        {/* Security Alert */}
        {securityAlert && (
          <SecurityAlert
            message={securityAlert}
            onDismiss={() => setSecurityAlert('')}
            darkMode={darkMode}
          />
        )}

        {/* Debug Panel */}
        {showDebug && (
          <DebugPanel
            healthStatus={healthStatus}
            systemMetrics={systemMetrics}
            lastQuery={inputValue}
            darkMode={darkMode}
          />
        )}

        {/* Messages */}
        <div className="flex-1 overflow-hidden">
          {messages.length === 0 ? (
            <WelcomeScreen
              userName={user?.username}
              isAuthenticated={isAuthenticated}
              darkMode={darkMode}
              onSuggestionClick={setInputValue}
            />
          ) : (
            <MessageList messages={messages} darkMode={darkMode} />
          )}
        </div>

        {/* Input */}
        <MessageInput
          value={inputValue}
          isLoading={isLoading}
          isAuthenticated={isAuthenticated}
          darkMode={darkMode}
          onValueChange={setInputValue}
          onSendMessage={handleSendMessage}
          onFileUpload={handleFileUpload}
          systemMetrics={systemMetrics}
        />
      </div>

      {/* Mobile sidebar overlay */}
      {showSidebar && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}
    </div>
  );
};

export default ChatApp;