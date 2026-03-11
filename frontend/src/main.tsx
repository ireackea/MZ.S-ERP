// ENTERPRISE FIX: Phase 3 - Full Legacy Removal & Complete Single Source of Truth - 2026-03-05
// ENTERPRISE FIX: Phase 2 - Full Single Source of Truth & Legacy Cleanup - 2026-03-05
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './i18n';
import '../themes/classic/index.css';

if (typeof document !== 'undefined') {
  document.documentElement.classList.add('classic');
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
