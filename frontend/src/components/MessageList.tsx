// frontend/src/components/MessageList.tsx
import React, { useRef, useEffect } from 'react';
import { FileText } from 'lucide-react';
import clsx from 'clsx';
import { Message } from '../services/api';

interface MessageListProps {
  messages: Message[];
  darkMode: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, darkMode }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const surfaceClasses = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
  );
};
