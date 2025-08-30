// frontend/src/components/WelcomeScreen.tsx
import React from 'react';
import { Zap } from 'lucide-react';
import clsx from 'clsx';

interface WelcomeScreenProps {
  userName?: string;
  isAuthenticated: boolean;
  darkMode: boolean;
  onSuggestionClick: (suggestion: string) => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  userName,
  isAuthenticated,
  darkMode,
  onSuggestionClick,
}) => {
  const textClasses = darkMode ? 'text-gray-100' : 'text-gray-900';
  const mutedTextClasses = darkMode ? 'text-gray-400' : 'text-gray-600';

  const suggestions = [
    'What can you help me with?',
    'Analyze my uploaded documents',
    'Show me recent insights',
    'Search through my data'
  ];

  return (
    <div className="text-center mt-8">
      <div className="mb-4">
        <Zap className="w-12 h-12 mx-auto text-blue-500 mb-4" />
        <h3 className={clsx('text-lg font-medium mb-2', textClasses)}>
          Welcome to ES Data Chat{userName ? `, ${userName}` : ''}!
        </h3>
        <p className={mutedTextClasses}>
          Start a conversation, upload documents, or ask questions about your data.
        </p>
        <p className={clsx('text-xs mt-2', mutedTextClasses)}>
          Powered by AI • Document Processing • Semantic Search
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 mt-4">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(suggestion)}
            className="px-3 py-1 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-200 dark:hover:bg-blue-900/50"
            disabled={!isAuthenticated}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
};
