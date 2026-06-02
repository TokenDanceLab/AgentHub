import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { useNotificationStore } from '@/stores/notificationStore';
import { NotificationBell } from './NotificationBell';

describe('NotificationBell', () => {
  beforeEach(async () => {
    useNotificationStore.getState().clearAll();
    await i18n.changeLanguage('en');
  });

  it('renders shared empty state through localized copy', () => {
    render(<NotificationBell />);

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(screen.getByRole('menu', { name: 'Notifications panel' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'No notifications yet' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No notifications yet' })).toBeInTheDocument();
    expect(screen.getByText('Agent approvals, mentions, and Hub delivery updates will appear here.')).toBeInTheDocument();
  });

  it('renders notification rows with localized actions', () => {
    useNotificationStore.getState().addNotification({
      id: 'n1',
      type: 'agent_task',
      title: 'Approval required',
      body: 'Codex wants to run a command.',
      read: false,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    });

    render(<NotificationBell />);

    fireEvent.click(screen.getByRole('button', { name: 'Notifications (1 unread)' }));

    expect(screen.getByText('Approval required')).toBeInTheDocument();
    expect(screen.getByText('Codex wants to run a command.')).toBeInTheDocument();
    expect(screen.getByText('1m ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});
