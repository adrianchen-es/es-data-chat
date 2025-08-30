import React from 'react';
import { createRoot } from 'react-dom/client';
import ChatApp from './App';
import './index.css';

// Initialize OpenTelemetry (commented out until dependencies are installed)
// import './telemetry/otel';

const container = document.getElementById('root');
if (!container) {
  const rootDiv = document.createElement('div');
  rootDiv.id = 'root';
  document.body.appendChild(rootDiv);
}

const root = createRoot(container || document.getElementById('root'));
root.render(React.createElement(ChatApp));
