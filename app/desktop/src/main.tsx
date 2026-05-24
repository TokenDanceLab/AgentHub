import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import AuthPage from '@/components/AuthPage';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import '@/i18n';
import '@/styles/themes.css';
import '@/styles/tokens.css';

function AppShell() {
  const auth = useAuth();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    auth.tryAutoLogin().finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoginSuccess = useCallback(() => {
    // Auth state updates via useAuth's subscribe mechanism trigger re-render
  }, []);

  if (checking) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--foreground)',
          fontSize: 14,
          fontFamily: 'var(--font-sans)',
        }}
        aria-busy="true"
        aria-label="Loading"
      >
        Loading...
      </div>
    );
  }

  return auth.isAuthenticated ? <App /> : <AuthPage onLoginSuccess={handleLoginSuccess} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
