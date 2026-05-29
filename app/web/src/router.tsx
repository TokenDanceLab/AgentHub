import { createBrowserRouter } from 'react-router-dom';
import App from './App';

export const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/agent-square', element: <App /> },
  { path: '/group/:id', element: <App /> },
  { path: '/chats', element: <App /> },
  { path: '/settings', element: <App /> },
  { path: '/project/:id', element: <App /> },
  { path: '*', element: <App /> },
]);
