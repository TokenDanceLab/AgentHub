import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/queryClient';
import App from '@/App';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import '@/i18n';
import '@/styles/tokens.css';
import '@/styles/themes.css';

function AppShell() {
  return <App />;
}

createRoot(document.getElementById('root')!).render(
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
