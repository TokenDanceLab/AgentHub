import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '../../__tests__/setup';
import { ContactsPage } from './ContactsPage';

describe('ContactsPage empty states', () => {
  it('uses shared EmptyState for the new-contacts primary empty path', () => {
    render(
      <ContactsPage
        activePane="new"
        onPaneChange={() => undefined}
        orgName="TokenDance"
        orgInitials="TD"
        members={[]}
        friendRequests={[]}
        pendingContacts={[]}
      />,
    );

    expect(
      screen.getByRole('region', { name: '暂无待处理的好友请求' }),
    ).toBeInTheDocument();
  });

  it('hides the primary empty path when received friend requests exist', () => {
    render(
      <ContactsPage
        activePane="new"
        onPaneChange={() => undefined}
        orgName="TokenDance"
        orgInitials="TD"
        members={[]}
        friendRequests={[
          {
            request_id: 'req-1',
            user_id: 'user-1',
            username: 'alice',
            nickname: 'Alice',
            message: 'hello',
            created_at: '2026-07-01T00:00:00Z',
          },
        ]}
        pendingContacts={[]}
      />,
    );

    expect(
      screen.queryByRole('region', { name: '暂无待处理的好友请求' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('收到的好友请求')).toBeInTheDocument();
  });
});
