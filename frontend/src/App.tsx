// frontend/src/App.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Upload, Activity, AlertCircle, CheckCircle } from 'lucide-react';

interface Message {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: Date;
  isStreaming?: boolean;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    api: boolean;
    ai: boolean;
    search: boolean;
  };
}

const ChatApp: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    status: 'healthy',
    services: { api: true, ai: true, search: true }
  });
  const [showDebug, setShowDebug] = useState(false);
  const [lastResponse, setLastResponse] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [debugData, setDebugData] = useState<any>({});
  const [securityAlert, setSecurityAlert] = useState<string>('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load chat history on mount
  useEffect(() => {
    const savedMessages = localStorage.getItem('chat-history');
    if (savedMessages) {
      setMessages(JSON.parse(savedMessages));
    }
  }, []);

  // Save chat history
  useEffect(() => {
    localStorage.setItem('chat-history', JSON.stringify(messages));
  }, [messages]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Health check simulation
  useEffect(() => {
    const checkHealth = () => {
      fetch('/api/health')
        .then(res => res.json())
        .then(data => setHealthStatus(data))
        .catch(() => setHealthStatus({
          status: 'unhealthy',
          services: { api: false, ai: false, search: false }
        }));
    };
    
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const simulateStreaming = async (response: string) => {
    const words = response.split(' ');
    let currentContent = '';
    
    const streamingId = Date.now().toString();
    setMessages(prev => [...prev, {
      id: streamingId,
      content: '',
      isUser: false,
      timestamp: new Date(),
      isStreaming: true
    }]);

    for (let i = 0; i < words.length; i++) {
      currentContent += words[i] + ' ';
      await new Promise(resolve => setTimeout(resolve, 50));
      
      setMessages(prev => prev.map(msg => 
        msg.id === streamingId 
          ? { ...msg, content: currentContent.trim() }
          : msg
      ));
    }

    setMessages(prev => prev.map(msg => 
      msg.id === streamingId 
        ? { ...msg, isStreaming: false }
        : msg
    ));
  };

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue,
      isUser: true,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Mock AI response with debug data
      const mockResponse = `I understand you're asking about "${inputValue}". This is a mock response that demonstrates the streaming functionality. In the full implementation, this would connect to the AI service with RAG capabilities and provide intelligent responses based on your data.`;
      
      const mockDebugData = {
        model_used: 'gpt-4o',
        processing_time_ms: 1200,
        rag_sources: ['document1.pdf', 'document2.docx'],
        elasticsearch_query: {
          query: { multi_match: { query: inputValue, fields: ['content^2', 'title'] } },
          size: 10
        },
        confidence: 0.85,
        cached: false
      };
      
      setLastResponse(mockResponse);
      setLastQuery(inputValue);
      setDebugData(mockDebugData);
      
      // Clear any previous security alerts
      setSecurityAlert('');
      
      await simulateStreaming(mockResponse);
    } catch (error: any) {
      let errorMessage = 'Sorry, I encountered an error. Please try again.';
      
      // Handle security-related errors
      if (error.status === 403) {
        const errorData = error.data || {};
        if (errorData.details?.code?.startsWith('SEC_')) {
          setSecurityAlert(errorData.details.message + ' ' + errorData.details.suggestion);
          errorMessage = errorData.details.message;
        } else {
          setSecurityAlert('Your message was blocked by security filters. Please rephrase and try again.');
          errorMessage = 'Message blocked for security reasons.';
        }
      } else if (error.status === 429) {
        setSecurityAlert('You are sending messages too quickly. Please wait a moment before trying again.');
        errorMessage = 'Rate limit exceeded. Please wait.';
      }
      
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        content: errorMessage,
        isUser: false,
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading]);

  const handleFileUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Mock file upload
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        content: `Uploaded file: ${file.name} (${(file.size / 1024).toFixed(1)} KB). File processing will be implemented in the backend service.`,
        isUser: false,
        timestamp: new Date()
      }]);
    }
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

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">AI Chat</h1>
          <div className="flex items-center gap-2">
            {getHealthIcon()}
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <Activity className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>
      </div>

      {/* Security Alert */}
      {securityAlert && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mx-4 mt-2">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">{securityAlert}</p>
              <button
                onClick={() => setSecurityAlert('')}
                className="mt-2 text-xs text-yellow-600 hover:text-yellow-800 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Debug Panel */}
      {showDebug && (
        <div className="bg-gray-100 border-b border-gray-200 p-3 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="mb-2"><strong>System Status:</strong> {healthStatus.status}</div>
              <div className="mb-2">
                <strong>Services:</strong> API: {healthStatus.services.api ? '✓' : '✗'}, 
                AI: {healthStatus.services.ai ? '✓' : '✗'}, 
                Search: {healthStatus.services.search ? '✓' : '✗'}
              </div>
              {debugData.model_used && (
                <div className="mb-2">
                  <strong>Model:</strong> {debugData.model_used} | 
                  <strong> Time:</strong> {debugData.processing_time_ms}ms | 
                  <strong> Confidence:</strong> {(debugData.confidence * 100).toFixed(1)}%
                </div>
              )}
            </div>
            <div>
              {debugData.rag_sources && debugData.rag_sources.length > 0 && (
                <div className="mb-2">
                  <strong>RAG Sources:</strong> {debugData.rag_sources.join(', ')}
                </div>
              )}
              {debugData.cached && (
                <div className="mb-1"><span className="bg-green-200 px-2 py-1 rounded text-xs">CACHED</span></div>
              )}
            </div>
          </div>
          
          {lastResponse && (
            <details className="mt-3">
              <summary className="cursor-pointer font-medium text-blue-600">Last AI Response</summary>
              <pre className="mt-2 p-2 bg-white rounded text-xs overflow-x-auto max-h-32">
{lastResponse}
              </pre>
            </details>
          )}
          
          {debugData.elasticsearch_query && (
            <details className="mt-2">
              <summary className="cursor-pointer font-medium text-purple-600">Elasticsearch Query</summary>
              <pre className="mt-2 p-2 bg-white rounded text-xs overflow-x-auto max-h-32">
{JSON.stringify(debugData.elasticsearch_query, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p>Start a conversation or upload a document to begin.</p>
          </div>
        )}
        
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs md:max-w-md lg:max-w-lg xl:max-w-xl rounded-lg px-4 py-2 ${
                message.isUser
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-900 border border-gray-200'
              }`}
            >
              <p className="text-sm">{message.content}</p>
              {message.isStreaming && (
                <div className="mt-1 flex items-center gap-1">
                  <div className="w-1 h-1 bg-gray-400 rounded-full animate-pulse"></div>
                  <div className="w-1 h-1 bg-gray-400 rounded-full animate-pulse delay-75"></div>
                  <div className="w-1 h-1 bg-gray-400 rounded-full animate-pulse delay-150"></div>
                </div>
              )}
              <p className="text-xs opacity-75 mt-1">
                {message.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".pdf,.docx,.doc,.pptx,.ppt"
            className="hidden"
          />
          <button
            onClick={handleFileUpload}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            disabled={isLoading}
          >
            <Upload className="w-5 h-5" />
          </button>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Ask a question or type a message..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatApp;