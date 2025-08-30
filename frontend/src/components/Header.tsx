// frontend/src/components/Header.tsx
import React from 'react';
import { Menu, Activity, Maximize2, Minimize2, LogOut, User, CheckCircle, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { HealthStatus } from '../services/api';

interface HeaderProps {
  user: any;
  isLoading: boolean;
  healthStatus: HealthStatus;
  showDebug: boolean;
  fullscreen: boolean;
  darkMode: boolean;
  onToggleSidebar: () => void;
  onToggleDebug: () => void;
  onToggleFullscreen: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  isLoading,
  healthStatus,
  showDebug,
  fullscreen,
  darkMode,
  onToggleSidebar,
  onToggleDebug,
  onToggleFullscreen,
  onLogout,
}) => {
  const surfaceClasses = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const textClasses = darkMode ? 'text-gray-100' : 'text-gray-900';

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
    <div className={clsx('border-b px-4 py-3', surfaceClasses)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
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
                onClick={onLogout}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
          {getHealthIcon()}
          <button
            onClick={onToggleDebug}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <Activity className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleFullscreen}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};
