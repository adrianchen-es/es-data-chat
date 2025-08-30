// frontend/src/App.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Send, Upload, Activity, AlertCircle, CheckCircle, 
  Menu, X, Settings, MessageSquare, FileText, Zap,
  Clock, Database, Shield, TrendingUp, Maximize2, Minimize2,
  LogOut, User
} from 'lucide-react';
import clsx from 'clsx';
import { telemetry } from './telemetry/otel';
import { apiService, Message, HealthStatus, SystemMetrics, ChatRequest } from './services/api';
import { useAuth } from './hooks/useAuth';
import { LoginForm } from './components/LoginForm';

const ChatApp: React.FC = () => {
  const { user, isAuthenticated, isLoading: authLoading, error: authError, login, logout, clearError } = useAuth();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    status: 'healthy',
    services: { api: true, ai: true, auth: true, documents: true },
    timestamp: new Date().toISOString()
  });
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>({
    totalMessages: 0,
    averageResponseTime: 0,
    cacheHitRate: 85,
    uptime: '2h 15m'
  });
  
  // UI State
  const [showSidebar, setShowSidebar] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [securityAlert, setSecurityAlert] = useState<string>('');
  const [lastQuery, setLastQuery] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initialize telemetry (simplified for now due to dependency issues)
  const trackUserAction = useCallback((action: string, metadata?: any) => {
    console.log(`[TRACE] User action: ${action}`, metadata);
    // This would integrate with OpenTelemetry when dependencies are available
  }, []);

  const trackApiCall = useCallback(async (endpoint: string, method: string, apiCall: () => Promise<any>) => {
    const startTime = Date.now();
    console.log(`[TRACE] API call started: ${method} ${endpoint}`);
    
    try {
      const result = await apiCall();
      const duration = Date.now() - startTime;
      console.log(`[TRACE] API call completed: ${method} ${endpoint} (${duration}ms)`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`[TRACE] API call failed: ${method} ${endpoint} (${duration}ms)`, error);
      throw error;
    }
  }, []);

  // Load chat history and preferences
  useEffect(() => {
    trackUserAction('app_load');
    
    const savedMessages = localStorage.getItem('chat-history');
    const savedDarkMode = localStorage.getItem('dark-mode') === 'true';
    
    if (savedMessages) {
      setMessages(JSON.parse(savedMessages));
    }
    setDarkMode(savedDarkMode);
    
    // Apply dark mode class
    if (savedDarkMode) {
      document.documentElement.classList.add('dark');
    }
  }, [trackUserAction]);

  // Save chat history and preferences
  useEffect(() => {
    localStorage.setItem('chat-history', JSON.stringify(messages));
    setSystemMetrics(prev => ({ ...prev, totalMessages: messages.filter(m => m.isUser).length }));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('dark-mode', darkMode.toString());
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Health check with proper error handling
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await apiService.getHealth();
        if (response.data) {
          setHealthStatus(response.data);
        } else {
          setHealthStatus({
            status: 'unhealthy',
            services: { api: false, ai: false, auth: false, documents: false },
            timestamp: new Date().toISOString()
          });
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
  }, []);

  // Generate conversation ID when starting new conversation
  const generateConversationId = useCallback(() => {
    return `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case 'k':
            e.preventDefault();
            if (isAuthenticated) {
              inputRef.current?.focus();
            }
            break;
          case 'd':
            e.preventDefault();
            setShowDebug(!showDebug);
            break;
        }
      }
      if (e.key === 'Escape') {
        setShowSidebar(false);
        setSecurityAlert('');
        clearError();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [showDebug, isAuthenticated, clearError]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading || !isAuthenticated) return;

    trackUserAction('send_message', { messageLength: inputValue.length });
    
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      content: inputValue,
      isUser: true,
      timestamp: new Date()
    };

    // Generate conversation ID if this is the first message
    const conversationId = currentConversationId || generateConversationId();
    if (!currentConversationId) {
      setCurrentConversationId(conversationId);
    }

    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage: Message = {
      id: assistantMessageId,
      content: '',
      isUser: false,
      timestamp: new Date(),
      isStreaming: true
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setLastQuery(inputValue);
    const currentInput = inputValue;
    setInputValue('');
    setIsLoading(true);

    try {
      // Use streaming chat for better UX
      await apiService.startChatStream(
        currentInput,
        conversationId,
        // onMessage: Update streaming content
        (content: string) => {
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { ...msg, content }
              : msg
          ));
        },
        // onComplete: Finalize the message
        (response) => {
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { 
                  ...msg, 
                  content: response.response,
                  isStreaming: false,
                  metadata: response.metadata
                }
              : msg
          ));
          
          // Update metrics
          if (response.metadata?.processing_time) {
            setSystemMetrics(prev => ({
              ...prev,
              averageResponseTime: Math.round((prev.averageResponseTime + response.metadata!.processing_time!) / 2)
            }));
          }
          
          setSecurityAlert('');
        },
        // onError: Handle errors
        (error: string) => {
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { 
                  ...msg, 
                  content: `Error: ${error}`,
                  isStreaming: false
                }
              : msg
          ));

          if (error.includes('blocked') || error.includes('security')) {
            setSecurityAlert('Your message was blocked by security filters. Please rephrase and try again.');
          } else if (error.includes('rate limit') || error.includes('429')) {
            setSecurityAlert('You are sending messages too quickly. Please wait a moment before trying again.');
          }
        }
      );
    } catch (error) {
      console.error('Error sending message:', error);
      
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessageId 
          ? { 
              ...msg, 
              content: 'Sorry, I encountered an error. Please try again.',
              isStreaming: false
            }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, isAuthenticated, currentConversationId, generateConversationId, trackUserAction]);

  const handleFileUpload = () => {
    trackUserAction('file_upload_click');
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      trackUserAction('file_selected', { 
        fileName: file.name, 
        fileSize: file.size,
        fileType: file.type 
      });
      
      handleFileUploadReal(file);
    }
  };

  const handleFileUploadReal = async (file: File) => {
    if (!isAuthenticated) {
      setSecurityAlert('Please log in to upload files.');
      return;
    }

    const uploadMessageId = `upload-${Date.now()}`;
    const uploadMessage: Message = {
      id: uploadMessageId,
      content: `📁 Uploading: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`,
      isUser: false,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, uploadMessage]);

    try {
      const response = await apiService.uploadDocument(file);
      
      if (response.data) {
        setMessages(prev => prev.map(msg => 
          msg.id === uploadMessageId 
            ? {
                ...msg,
                content: `✅ Successfully uploaded: ${file.name}\n\n` +
                        `Document ID: ${response.data!.document_id}\n` +
                        `Status: ${response.data!.status}\n` +
                        `Processing: ${response.data!.processing_started ? 'Started' : 'Queued'}\n\n` +
                        `The document is now being processed and will be available for search in your conversations.`,
                metadata: {
                  sources: [response.data?.document_id || 'unknown']
                }
              }
            : msg
        ));
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    } catch (error) {
      setMessages(prev => prev.map(msg => 
        msg.id === uploadMessageId 
          ? {
              ...msg,
              content: `❌ Upload failed: ${file.name}\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease try again or contact support if the problem persists.`
            }
          : msg
      ));
      
      setSecurityAlert(`File upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const clearChat = () => {
    trackUserAction('clear_chat');
    setMessages([]);
    setLastQuery('');
    setCurrentConversationId(null);
  };

  const handleLogout = async () => {
    trackUserAction('logout');
    await logout();
    setMessages([]);
    setCurrentConversationId(null);
    setSecurityAlert('');
  };

  const toggleSidebar = () => {
    trackUserAction('toggle_sidebar');
    setShowSidebar(!showSidebar);
  };

  const getHealthIcon = () => {
    switch (healthStatus.status) {
      case 'healthy':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'degraded':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const formatUptime = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  };

  const themeClasses = darkMode ? 'dark bg-gray-900' : 'bg-gray-50';
  const surfaceClasses = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const textClasses = darkMode ? 'text-gray-100' : 'text-gray-900';
  const mutedTextClasses = darkMode ? 'text-gray-400' : 'text-gray-600';

  // Show login form if not authenticated
  if (!isAuthenticated && !authLoading) {
    return (
      <div className={themeClasses}>
        <LoginForm
          onLogin={login}
          isLoading={authLoading}
          error={authError || undefined}
          darkMode={darkMode}
        />
      </div>
    );
  }

  // Show loading screen while checking authentication
  if (authLoading) {
    return (
      <div className={clsx('flex h-screen items-center justify-center', themeClasses)}>
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className={textClasses}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('flex h-screen', themeClasses, { 'fixed inset-0 z-50': fullscreen })}>
      {/* Sidebar */}
      <div className={clsx(
        'fixed inset-y-0 left-0 z-50 w-64 transform transition-transform lg:translate-x-0 lg:static lg:inset-0',
        surfaceClasses,
        showSidebar ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className={clsx('text-lg font-semibold', textClasses)}>ES Data Chat</h2>
          <button
            onClick={() => setShowSidebar(false)}
            className="lg:hidden p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          {/* System Status */}
          <div className="space-y-2">
            <h3 className={clsx('text-sm font-medium', textClasses)}>System Status</h3>
            <div className="flex items-center gap-2">
              {getHealthIcon()}
              <span className={clsx('text-sm', mutedTextClasses)}>
                {healthStatus.status.charAt(0).toUpperCase() + healthStatus.status.slice(1)}
              </span>
            </div>
            <div className="text-xs space-y-1">
              {Object.entries(healthStatus.services).map(([service, status]) => (
                <div key={service} className="flex justify-between">
                  <span className={mutedTextClasses}>
                    {service === 'api' ? 'BFF' : service}:
                  </span>
                  <span className={status ? 'text-green-500' : 'text-red-500'}>
                    {status ? '✓' : '✗'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* User Info */}
          {user && (
            <div className="space-y-2">
              <h3 className={clsx('text-sm font-medium', textClasses)}>User</h3>
              <div className="text-xs space-y-1">
                <div className={mutedTextClasses}>ID: {user.user_id}</div>
                <div className={mutedTextClasses}>Username: {user.username}</div>
                {user.email && <div className={mutedTextClasses}>Email: {user.email}</div>}
                {user.roles && user.roles.length > 0 && (
                  <div className={mutedTextClasses}>
                    Roles: {user.roles.join(', ')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Current Conversation */}
          {currentConversationId && (
            <div className="space-y-2">
              <h3 className={clsx('text-sm font-medium', textClasses)}>Current Chat</h3>
              <div className="text-xs">
                <div className={mutedTextClasses}>
                  ID: {currentConversationId.slice(-8)}...
                </div>
              </div>
            </div>
          )}

          {/* Metrics */}
          <div className="space-y-2">
            <h3 className={clsx('text-sm font-medium', textClasses)}>Metrics</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3 h-3" />
                <span className={mutedTextClasses}>{systemMetrics.totalMessages} messages</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3" />
                <span className={mutedTextClasses}>{systemMetrics.averageResponseTime}ms avg</span>
              </div>
              <div className="flex items-center gap-2">
                <Database className="w-3 h-3" />
                <span className={mutedTextClasses}>{systemMetrics.cacheHitRate}% cache hit</span>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3 h-3" />
                <span className={mutedTextClasses}>Uptime: {formatUptime(healthStatus.timestamp)}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button
              onClick={clearChat}
              className={clsx(
                'w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700',
                mutedTextClasses
              )}
            >
              Clear Chat
            </button>
            <button
              onClick={() => setShowDebug(!showDebug)}
              className={clsx(
                'w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700',
                mutedTextClasses
              )}
            >
              {showDebug ? 'Hide' : 'Show'} Debug
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={clsx(
                'w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700',
                mutedTextClasses
              )}
            >
              {darkMode ? 'Light' : 'Dark'} Mode
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className={clsx('border-b px-4 py-3', surfaceClasses)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSidebar}
                className="lg:hidden p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Menu className="w-5 h-5" />
              </button>
              <h1 className={clsx('text-lg font-semibold', textClasses)}>AI Assistant</h1>
              {isLoading && (
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse delay-75"></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse delay-150"></div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {user && (
                <div className="flex items-center gap-2 mr-4">
                  <User className="w-4 h-4" />
                  <span className={clsx('text-sm', textClasses)}>{user.username}</span>
                  <button
                    onClick={handleLogout}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    title="Logout"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              )}
              {getHealthIcon()}
              <button
                onClick={() => setShowDebug(!showDebug)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <Activity className="w-4 h-4" />
              </button>
              <button
                onClick={() => setFullscreen(!fullscreen)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Security Alert */}
        {securityAlert && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 p-4 mx-4 mt-2">
            <div className="flex">
              <AlertCircle className="h-5 w-5 text-yellow-400 flex-shrink-0" />
              <div className="ml-3 flex-1">
                <p className="text-sm text-yellow-700 dark:text-yellow-300">{securityAlert}</p>
                <button
                  onClick={() => setSecurityAlert('')}
                  className="mt-2 text-xs text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200 underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Debug Panel */}
        {showDebug && (
          <div className={clsx('border-b p-3 text-sm', surfaceClasses)}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="mb-2">
                  <strong>System:</strong> {healthStatus.status} | 
                  <strong> Messages:</strong> {systemMetrics.totalMessages} |
                  <strong> Avg Response:</strong> {systemMetrics.averageResponseTime}ms
                </div>
                {lastQuery && (
                  <div className="mb-2">
                    <strong>Last Query:</strong> <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{lastQuery}</code>
                  </div>
                )}
              </div>
              <div className="text-xs">
                <div><strong>Shortcuts:</strong></div>
                <div>⌘/Ctrl + K: Focus input</div>
                <div>⌘/Ctrl + D: Toggle debug</div>
                <div>⌘/Ctrl + Enter: Send message</div>
                <div>Esc: Close panels</div>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center mt-8">
              <div className="mb-4">
                <Zap className="w-12 h-12 mx-auto text-blue-500 mb-4" />
                <h3 className={clsx('text-lg font-medium mb-2', textClasses)}>
                  Welcome to ES Data Chat, {user?.username}!
                </h3>
                <p className={mutedTextClasses}>
                  Start a conversation, upload documents, or ask questions about your data.
                </p>
                <p className={clsx('text-xs mt-2', mutedTextClasses)}>
                  Powered by AI • Document Processing • Semantic Search
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {[
                  'What can you help me with?',
                  'Analyze my uploaded documents',
                  'Show me recent insights',
                  'Search through my data'
                ].map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => setInputValue(suggestion)}
                    className="px-3 py-1 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-200 dark:hover:bg-blue-900/50"
                    disabled={!isAuthenticated}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={clsx(
                  'max-w-xs sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl rounded-lg px-4 py-3',
                  message.isUser
                    ? 'bg-blue-500 text-white'
                    : clsx(surfaceClasses, 'shadow-sm')
                )}
              >
                <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                
                {message.isStreaming && (
                  <div className="mt-2 flex items-center gap-1">
                    <div className="w-1 h-1 bg-gray-400 rounded-full animate-pulse"></div>
                    <div className="w-1 h-1 bg-gray-400 rounded-full animate-pulse delay-75"></div>
                    <div className="w-1 h-1 bg-gray-400 rounded-full animate-pulse delay-150"></div>
                  </div>
                )}
                
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs opacity-75">
                    {message.timestamp.toLocaleTimeString()}
                  </p>
                  
                  {message.metadata && !message.isUser && (
                    <div className="flex items-center gap-1 text-xs opacity-75">
                      {message.metadata.model && (
                        <span className="bg-black/10 px-1 rounded">{message.metadata.model}</span>
                      )}
                      {message.metadata.confidence && (
                        <span>{Math.round(message.metadata.confidence * 100)}%</span>
                      )}
                      {message.metadata.processingTime && (
                        <span>{Math.round(message.metadata.processingTime)}ms</span>
                      )}
                    </div>
                  )}
                </div>
                
                {message.metadata?.sources && message.metadata.sources.length > 0 && (
                  <div className="mt-2 text-xs opacity-75">
                    <div className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      <span>Sources: {message.metadata.sources.join(', ')}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className={clsx('border-t p-4', surfaceClasses)}>
          <div className="flex items-end gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md"
              className="hidden"
            />
            <button
              onClick={handleFileUpload}
              disabled={isLoading || !isAuthenticated}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-50"
              title={!isAuthenticated ? "Login required" : "Upload file"}
            >
              <Upload className="w-5 h-5" />
            </button>
            <div className="flex-1">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={isAuthenticated ? "Ask a question or type a message... (⌘+K to focus, ⌘+Enter to send)" : "Please log in to start chatting..."}
                className={clsx(
                  'w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none',
                  'min-h-[40px] max-h-32',
                  surfaceClasses,
                  textClasses
                )}
                disabled={isLoading || !isAuthenticated}
                rows={1}
                style={{ 
                  height: 'auto',
                  minHeight: '40px',
                  maxHeight: '128px'
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
                }}
              />
            </div>
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading || !isAuthenticated}
              className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={!isAuthenticated ? "Login required" : "Send message"}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex items-center justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-4">
              <span>Supports: PDF, DOCX, PPTX, TXT, MD</span>
              {systemMetrics.cacheHitRate > 0 && (
                <span className="flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  {systemMetrics.cacheHitRate}% cached
                </span>
              )}
              {isAuthenticated && (
                <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                  <CheckCircle className="w-3 h-3" />
                  Authenticated
                </span>
              )}
            </div>
            <span>
              {isAuthenticated ? 'Shift+Enter for new line' : 'Please log in to chat'}
            </span>
          </div>
        </div>
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