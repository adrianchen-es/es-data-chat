// frontend/src/components/DebugPanel.tsx
import React from 'react';
import clsx from 'clsx';
import { HealthStatus, SystemMetrics } from '../services/api';

interface DebugPanelProps {
  healthStatus: HealthStatus;
  systemMetrics: SystemMetrics;
  lastQuery: string;
  darkMode: boolean;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  healthStatus,
  systemMetrics,
  lastQuery,
  darkMode,
}) => {
  const surfaceClasses = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';

  return (
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
  );
};
