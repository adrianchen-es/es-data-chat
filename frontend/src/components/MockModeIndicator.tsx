// frontend/src/components/MockModeIndicator.tsx
import React from 'react';
import clsx from 'clsx';

interface MockModeIndicatorProps {
  isVisible: boolean;
  darkMode: boolean;
  onDismiss?: () => void;
}

const MockModeIndicator: React.FC<MockModeIndicatorProps> = ({
  isVisible,
  darkMode,
  onDismiss
}) => {
  if (!isVisible) return null;

  return (
    <div className={clsx(
      'border-l-4 border-yellow-500 p-4 mx-4 my-2 rounded-r-lg shadow-md transition-all duration-300',
      {
        'bg-yellow-50 text-yellow-800': !darkMode,
        'bg-yellow-900/20 text-yellow-200': darkMode
      }
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-yellow-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.485 3.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 3.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium">
              Demo Mode Active
            </p>
            <p className="text-xs mt-1 opacity-80">
              Responses are simulated. Configure AI API keys for real responses.
            </p>
          </div>
        </div>
        {onDismiss && (
          <div className="flex-shrink-0 ml-4">
            <button
              onClick={onDismiss}
              className={clsx(
                'rounded-md p-1.5 transition-colors',
                {
                  'text-yellow-600 hover:bg-yellow-100': !darkMode,
                  'text-yellow-400 hover:bg-yellow-800/30': darkMode
                }
              )}
            >
              <span className="sr-only">Dismiss</span>
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div className="mt-2">
        <div className="flex items-center space-x-2 text-xs">
          <div className="flex items-center">
            <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse mr-1"></div>
            <span>Mock AI Service</span>
          </div>
          <span>•</span>
          <span>Simulated Responses</span>
          <span>•</span>
          <span>No API Keys Required</span>
        </div>
      </div>
    </div>
  );
};

export default MockModeIndicator;
