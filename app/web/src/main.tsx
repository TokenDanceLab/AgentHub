import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
<<<<<<< HEAD
=======
import '@/styles/tokens.css';
import '@/i18n';
>>>>>>> origin/dev/delicious233
import App from '@/App';
import '@/i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
