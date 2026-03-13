// ENTERPRISE FIX: Phase 7 - Production Deployment & Monitoring Setup - 2026-03-13
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './i18n';
import '../themes/classic/index.css';

declare const __APP_MONITORING__: {
  enabled: boolean;
  provider: 'sentry' | 'logrocket' | 'disabled';
  sentryDsn: string;
  logRocketAppId: string;
  environment: string;
  release: string;
};

type WindowWithSentry = Window & {
  Sentry?: {
    init: (config: Record<string, unknown>) => void;
    captureException?: (error: unknown) => void;
  };
};

const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
  if (typeof document === 'undefined') {
    resolve();
    return;
  }

  const existing = document.querySelector(`script[data-monitoring-src="${src}"]`);
  if (existing) {
    resolve();
    return;
  }

  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.dataset.monitoringSrc = src;
  script.onload = () => resolve();
  script.onerror = () => reject(new Error(`Failed to load monitoring script: ${src}`));
  document.head.appendChild(script);
});

const setupSentryMonitoring = async () => {
  if (!__APP_MONITORING__.enabled || __APP_MONITORING__.provider !== 'sentry' || !__APP_MONITORING__.sentryDsn) {
    return;
  }

  await loadScript('https://browser.sentry-cdn.com/8.38.0/bundle.min.js');
  const monitoringWindow = window as WindowWithSentry;
  monitoringWindow.Sentry?.init({
    dsn: __APP_MONITORING__.sentryDsn,
    environment: __APP_MONITORING__.environment,
    release: __APP_MONITORING__.release,
    tracesSampleRate: 0.1,
  });
};

if (typeof window !== 'undefined' && import.meta.env.PROD) {
  void setupSentryMonitoring().catch((error) => {
    console.error('[monitoring] Failed to initialize Sentry:', error);
  });
}

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
