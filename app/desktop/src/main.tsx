import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { queryClient } from '@/api/queryClient';
import { setEdgeAuthToken } from '@/api/edgeAuth';
import App from '@/App';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import i18n from '@/i18n';
import '@/styles/tokens.css';
import '@/styles/themes.css';
import '@/styles/presets.css';

/**
 * Syncs tray menu labels with the current i18n language.
 * Runs once on mount and again whenever the user switches language.
 * Silently ignores failures (e.g. running in a browser preview without a tray).
 */
function TrayLabelSyncer() {
  const { t } = useTranslation();

  useEffect(() => {
    const sync = () => {
      invoke('set_tray_labels', {
        labels: {
          show: t('tray.showWindow'),
          hide: t('tray.hideWindow'),
          start_edge: t('tray.startEdge'),
          stop_edge: t('tray.stopEdge'),
          quit: t('tray.quit'),
          tooltip: t('tray.tooltip'),
        },
      }).catch(() => {
        // Tray icon does not exist in browser previews — ignore silently.
      });
    };

    sync();
    i18n.on('languageChanged', sync);
    return () => {
      i18n.off('languageChanged', sync);
    };
  }, [t]);

  return null;
}

function AppShell() {
  return (
    <>
      <TrayLabelSyncer />
      <App />
    </>
  );
}

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
