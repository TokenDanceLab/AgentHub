import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';

const AgentSquare = lazy(() => import('./pages/AgentSquare'));
const GroupWorkspace = lazy(() => import('./pages/GroupWorkspace'));
const PrivateChats = lazy(() => import('./pages/PrivateChats'));
const Project = lazy(() => import('./pages/Project'));
const Workbench = lazy(() => import('./pages/Workbench'));

export const router = createBrowserRouter([
  { path: '/', element: <Workbench /> },
  { path: '/agent-square', element: <AgentSquare /> },
  { path: '/group/:id', element: <GroupWorkspace /> },
  { path: '/chats', element: <PrivateChats /> },
  { path: '/project/:id', element: <Project /> },
]);
