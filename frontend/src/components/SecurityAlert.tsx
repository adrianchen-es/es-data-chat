// frontend/src/components/SecurityAlert.tsx
import React from 'react';
import { AlertCircle } from 'lucide-react';

interface SecurityAlertProps {
  alert: string;
  onDismiss: () => void;
}

export const SecurityAlert: React.FC<SecurityAlertProps> = ({ alert, onDismiss }) => {
  if (!alert) return null;

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 p-4 mx-4 mt-2">
      <div className="flex">
        <AlertCircle className="h-5 w-5 text-yellow-400 flex-shrink-0" />
        <div className="ml-3 flex-1">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">{alert}</p>
          <button
            onClick={onDismiss}
            className="mt-2 text-xs text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200 underline"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
