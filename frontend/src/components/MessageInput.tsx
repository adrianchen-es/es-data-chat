// frontend/src/components/MessageInput.tsx
import React, { useRef } from 'react';
import { Send, Upload, Shield, CheckCircle } from 'lucide-react';
import clsx from 'clsx';
import { SystemMetrics } from '../services/api';

interface MessageInputProps {
  inputValue: string;
  setInputValue: (value: string) => void;
  isLoading: boolean;
  isAuthenticated: boolean;
  systemMetrics: SystemMetrics;
  darkMode: boolean;
  onSendMessage: () => void;
  onFileUpload: () => void;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  inputValue,
  setInputValue,
  isLoading,
  isAuthenticated,
  systemMetrics,
  darkMode,
  onSendMessage,
  onFileUpload,
  onFileChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  const surfaceClasses = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const textClasses = darkMode ? 'text-gray-100' : 'text-gray-900';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
  };

  return (
    <div className={clsx('border-t p-4', surfaceClasses)}>
      <div className="flex items-end gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileChange}
          accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md"
          className="hidden"
        />
        <button
          onClick={onFileUpload}
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
            onKeyDown={handleKeyDown}
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
            onInput={handleInput}
          />
        </div>
        <button
          onClick={onSendMessage}
          disabled={!inputValue.trim() || isLoading || !isAuthenticated}
          className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
  );
};
