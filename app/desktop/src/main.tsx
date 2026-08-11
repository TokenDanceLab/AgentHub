import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { queryClient } from '@/api/queryClient';
import { setEdgeAuthToken } from '@/api/edgeAuth';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { setToastHandler } from '@shared/errorReporting';
import { useToastStore } from '@shared/ui/toast';
import { AppShell } from '@/AppShell';
import '@/styles/tokens.css';
import '@/styles/themes.css';
import '@/styles/presets.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}
const rootElement = root;

async function hydrateEdgeAuthToken(): Promise<void> {
  try {
    setEdgeAuthToken(await invoke<string>('get_edge_auth_token'));
  } catch {
    // Browser preview or older Tauri shell: Edge auth remains disabled/externally configured.
  }
}

function renderApp(): void {
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

  createRoot(rootElement).render(
    <StrictMode>
      <LanguageProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <ErrorBoundary>
              <AppShell />
            </ErrorBoundary>
          </QueryClientProvider>
        </ThemeProvider>
      </LanguageProvider>
    </StrictMode>,
  );
}

void hydrateEdgeAuthToken().finally(renderApp);
