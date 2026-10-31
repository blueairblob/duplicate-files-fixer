import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { DPRProvider } from './contexts/DPRContext.jsx';
import './index.css';
import { migrateStorage } from './utils/migrateStorage.js';

// Carry settings/history over from before the Holdfast rename (one-time).
migrateStorage();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DPRProvider>
      <App />
    </DPRProvider>
  </React.StrictMode>
);
