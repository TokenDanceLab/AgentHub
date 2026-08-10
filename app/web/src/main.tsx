import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/tokens.css';
import '@/styles/themes.css';
import '@/styles/presets.css';
import '@/i18n';
import App from '@/App';
import ErrorBoundary from '@/components/ErrorBoundary';
import { setToastHandler } from '@shared/errorReporting';
import { useToastStore } from '@shared/ui/toast';

// Bridge global error reporter to toast notifications. The reporter already
// cleans technical strings out of `config.message` (see friendlyErrorMessage)
// and surfaces a `traceId` when the caller provided one; we append it here
// as secondary text so users can quote it to support without seeing the raw
// server string, and forward the optional Retry action to the toast host.
setToastHandler((config) => {
  const message = config.traceId
    ? `${config.title}: ${config.message} (trace: ${config.traceId})`
    : (config.title ? `${config.title}: ${config.message}` : config.message);
  useToastStore.getState().showToast(
    config.severity as 'error' | 'warning' | 'info',
    message,
    config.action ? { action: config.action } : undefined,
  );
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('root element #root not found');
createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
