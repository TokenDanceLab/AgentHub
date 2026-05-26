import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
<<<<<<< HEAD
=======
import '@/styles/tokens.css';
import '@/i18n';
>>>>>>> origin/dev/maintainer
import App from '@/App';
import '@/i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
