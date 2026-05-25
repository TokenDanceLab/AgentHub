import { lazy } from 'react';
<<<<<<< HEAD
import { createBrowserRouter } from 'react-router-dom';

const AgentSquare = lazy(() => import('./pages/AgentSquare'));
const GroupWorkspace = lazy(() => import('./pages/GroupWorkspace'));
const PrivateChats = lazy(() => import('./pages/PrivateChats'));
const Project = lazy(() => import('./pages/Project'));
const Workbench = lazy(() => import('./pages/Workbench'));
=======
import { createBrowserRouter, Navigate } from 'react-router-dom';

const AgentSquare = lazy(() => import('@/pages/AgentSquare'));
const GroupWorkspace = lazy(() => import('@/pages/GroupWorkspace'));
const PrivateChats = lazy(() => import('@/pages/PrivateChats'));
const Project = lazy(() => import('@/pages/Project'));
const Workbench = lazy(() => import('@/pages/Workbench'));
>>>>>>> origin/dev/trump

export const router = createBrowserRouter([
  { path: '/', element: <Workbench /> },
  { path: '/agent-square', element: <AgentSquare /> },
<<<<<<< HEAD
  { path: '/group/:id', element: <GroupWorkspace /> },
  { path: '/chats', element: <PrivateChats /> },
  { path: '/project/:id', element: <Project /> },
=======
  { path: '/chats', element: <PrivateChats /> },
  { path: '/group/workbench', element: <GroupWorkspace /> },
  { path: '/group/:id', element: <GroupWorkspace /> },
  { path: '/project/agent-hub', element: <Project /> },
  { path: '/project/:id', element: <Project /> },
  { path: '*', element: <Navigate to="/" replace /> },
>>>>>>> origin/dev/trump
]);
