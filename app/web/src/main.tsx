import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/tokens.css';
import '@/styles/themes.css';
import '@/styles/presets.css';
import '@/i18n';
import App from '@/App';
import ErrorBoundary from '@/components/ErrorBoundary';
import { setToastHandler } from '@shared/errorReporting';
import { useToastStore } from '@/stores/toastStore';

// Bridge global error reporter to toast notifications
setToastHandler((config) => {
  useToastStore.getState().showToast(
    config.severity as 'error' | 'warning' | 'info',
    config.title ? `${config.title}: ${config.message}` : config.message,
  );
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
