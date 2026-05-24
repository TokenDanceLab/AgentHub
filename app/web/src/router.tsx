import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

const AgentSquare = lazy(() => import('@/pages/AgentSquare'));
const GroupWorkspace = lazy(() => import('@/pages/GroupWorkspace'));
const PrivateChats = lazy(() => import('@/pages/PrivateChats'));
const Project = lazy(() => import('@/pages/Project'));
const Workbench = lazy(() => import('@/pages/Workbench'));

export const router = createBrowserRouter([
  { path: '/', element: <Workbench /> },
  { path: '/agent-square', element: <AgentSquare /> },
  { path: '/chats', element: <PrivateChats /> },
  { path: '/group/workbench', element: <GroupWorkspace /> },
  { path: '/group/:id', element: <GroupWorkspace /> },
  { path: '/project/agent-hub', element: <Project /> },
  { path: '/project/:id', element: <Project /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
