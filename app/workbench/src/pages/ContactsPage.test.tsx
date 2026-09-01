import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { fireEvent, render, screen } from '../__tests__/setup';
import { ContactsPage } from './ContactsPage';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

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

describe('ContactsPage infinite scroll (T14 skeleton)', () => {
  const BASE_PROPS = {
    activePane: 'internal' as const,
    onPaneChange: () => undefined,
    orgName: 'TokenDance',
    orgInitials: 'TD',
    members: [],
  };

  it('renders no load-more affordance when pagination props are absent', () => {
    render(<ContactsPage {...BASE_PROPS} />);

    expect(
      screen.queryByRole('button', { name: '加载更多' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('加载中…')).not.toBeInTheDocument();
  });

  it('shows the fallback load-more button when hasMore is set and fires onLoadMore', () => {
    const onLoadMore = vi.fn();
    render(<ContactsPage {...BASE_PROPS} hasMore onLoadMore={onLoadMore} />);

    const button = screen.getByRole('button', { name: '加载更多' });
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows loading status and hides the button while loadingMore', () => {
    render(<ContactsPage {...BASE_PROPS} hasMore loadingMore />);

    expect(
      screen.queryByRole('button', { name: '加载更多' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });
});
