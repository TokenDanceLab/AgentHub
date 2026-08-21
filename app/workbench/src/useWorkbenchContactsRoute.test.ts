import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_MOCK_CONTACT_MEMBER_POOL,
  WORKBENCH_MOCK_PAGE_SIZE,
} from './mockData';
import { useWorkbenchContactsRoute } from './useWorkbenchContactsRoute';

describe('useWorkbenchContactsRoute mock cursor pagination (#1510)', () => {
  it('loads the first page (PAGE_SIZE) and reports hasMore when the pool is larger', () => {
    const { result } = renderHook(() => useWorkbenchContactsRoute({}));

    expect(result.current.contactsData.members).toHaveLength(WORKBENCH_MOCK_PAGE_SIZE);
    expect(result.current.contactsData.members[0]?.id).toBe('delicious');
    expect(result.current.hasMore).toBe(true);
    expect(result.current.loadingMore).toBe(false);
    expect(typeof result.current.onLoadMore).toBe('function');
  });

  it('appends the next page on loadMore and flips hasMore=false when the pool is exhausted', async () => {
    const { result } = renderHook(() => useWorkbenchContactsRoute({}));

    await act(async () => {
      result.current.onLoadMore?.();
    });
    expect(result.current.contactsData.members).toHaveLength(
      WORKBENCH_MOCK_CONTACT_MEMBER_POOL.length,
    );
    expect(result.current.hasMore).toBe(false);

    // A further loadMore is a no-op once exhausted.
    const lengthAfterExhaustion = result.current.contactsData.members.length;
    await act(async () => {
      result.current.onLoadMore?.();
    });
    expect(result.current.contactsData.members).toHaveLength(lengthAfterExhaustion);
    expect(result.current.hasMore).toBe(false);
  });

  it('guards against concurrent loadMore reentry (one page per call)', async () => {
    const { result } = renderHook(() => useWorkbenchContactsRoute({}));
    const before = result.current.contactsData.members.length;

    await act(async () => {
      // Two synchronous calls while the first page fetch is in flight.
      result.current.onLoadMore?.();
      result.current.onLoadMore?.();
    });

    expect(result.current.contactsData.members.length).toBe(
      Math.min(before + WORKBENCH_MOCK_PAGE_SIZE, WORKBENCH_MOCK_CONTACT_MEMBER_POOL.length),
    );
  });

  it('keeps pagination inert on panes without a paginated list', () => {
    const { result } = renderHook(() => useWorkbenchContactsRoute({}));
    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.setContactsPane('external');
    });
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.onLoadMore).toBeUndefined();
  });

  it('stays inert when the parent supplies contacts data', async () => {
    const { result } = renderHook(() => useWorkbenchContactsRoute({
      contacts: {
        members: [{ id: 'm1', name: 'Alice', initials: 'A', org: 'TD', status: '在线' }],
        orgName: 'Acme',
        orgInitials: 'AC',
      },
    }));

    expect(result.current.contactsData.members).toHaveLength(1);
    expect(result.current.contactsData.orgName).toBe('Acme');
    expect(result.current.hasMore).toBe(false);
    expect(result.current.onLoadMore).toBeUndefined();

    await act(async () => {
      result.current.onLoadMore?.();
    });
    expect(result.current.contactsData.members).toHaveLength(1);
  });
});
