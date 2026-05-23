import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { ThemeProvider } from '@/contexts/ThemeContext';
import '@/i18n';
import '@/styles/themes.css';
import '@/styles/tokens.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
