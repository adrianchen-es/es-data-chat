// frontend/src/components/Sidebar.tsx
import React from 'react';
import { X, CheckCircle, AlertCircle, MessageSquare, Clock, Database, TrendingUp, User } from 'lucide-react';
import clsx from 'clsx';
import { HealthStatus, SystemMetrics } from '../services/api';

interface SidebarProps {
  isVisible: boolean;
  onClose: () => void;
  healthStatus: HealthStatus;
  systemMetrics: SystemMetrics;
  user: any;
  currentConversationId: string | null;
  darkMode: boolean;
  onClearChat: () => void;
  onToggleDebug: () => void;
  onToggleDarkMode: () => void;
  showDebug: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isVisible,
  onClose,
  healthStatus,
  systemMetrics,
  user,
  currentConversationId,
  darkMode,
  onClearChat,
  onToggleDebug,
  onToggleDarkMode,
  showDebug,
}) => {
  const surfaceClasses = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const textClasses = darkMode ? 'text-gray-100' : 'text-gray-900';
  const mutedTextClasses = darkMode ? 'text-gray-400' : 'text-gray-600';

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

  return (
    <div className={clsx(
      'fixed inset-y-0 left-0 z-50 w-64 transform transition-transform lg:translate-x-0 lg:static lg:inset-0',
      surfaceClasses,
      isVisible ? 'translate-x-0' : '-translate-x-full'
    )}>
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className={clsx('text-lg font-semibold', textClasses)}>ES Data Chat</h2>
        <button
          onClick={onClose}
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
            onClick={onClearChat}
            className={clsx(
              'w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700',
              mutedTextClasses
            )}
          >
            Clear Chat
          </button>
          <button
            onClick={onToggleDebug}
            className={clsx(
              'w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700',
              mutedTextClasses
            )}
          >
            {showDebug ? 'Hide' : 'Show'} Debug
          </button>
          <button
            onClick={onToggleDarkMode}
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
  );
};
