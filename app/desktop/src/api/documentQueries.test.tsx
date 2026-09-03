// #2290 defect class, documents: `useDocumentList` was called with `undefined`
// by its only caller (desktop/src/App.tsx:198), so it fetched the first page and
// dropped `page.nextCursor` — documents past the server's default page never
// reached the Docs page, and a short list was indistinguishable from "no more
// documents". The walk now lives in @shared/hub/paginate; caller-supplied
// filters must survive it.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubClient } from '@/api/hubClient';
import { useDocumentList } from './documentQueries';

vi.mock('@/api/hubClient', () => ({ createHubClient: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ getAccessToken: vi.fn(() => 'fixture-token') }));

const client = { listDocuments: vi.fn() };

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createHubClient).mockReturnValue(client as never);
});

describe('desktop document list', () => {
  it('walks cursor pages instead of keeping only the first one', async () => {
    client.listDocuments
      .mockResolvedValueOnce({
        items: [{ id: 'd-1' }],
        page: { hasMore: true, nextCursor: 'cur-1' },
      })
      .mockResolvedValueOnce({ items: [{ id: 'd-2' }], page: { hasMore: false } });

    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useDocumentList(undefined, { enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(client.listDocuments).toHaveBeenCalledTimes(2));

    // The first call must state the page size: parameterless means the server
    // default, which is what hid the tail of the list.
    expect(client.listDocuments).toHaveBeenNthCalledWith(1, { pageSize: 200 });
    expect(client.listDocuments).toHaveBeenNthCalledWith(2, {
      pageSize: 200,
      pageCursor: 'cur-1',
    });
    expect(result.current.data?.items.map((d) => d.id)).toEqual(['d-1', 'd-2']);
    expect(result.current.data?.page.hasMore).toBe(false);
    queryClient.clear();
  });

  it('preserves caller filters under the walk', async () => {
    client.listDocuments.mockResolvedValue({ items: [], page: { hasMore: false } });

    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(
      () => useDocumentList({ status: 'active', tag: 'runbook' }, { enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.listDocuments).toHaveBeenCalledTimes(1);
    expect(client.listDocuments).toHaveBeenCalledWith({
      status: 'active',
      tag: 'runbook',
      pageSize: 200,
    });
    queryClient.clear();
  });

  it('reports hasMore when the page cap is what stopped the walk', async () => {
    client.listDocuments.mockResolvedValue({
      items: [{ id: 'd-x' }],
      page: { hasMore: true, nextCursor: 'cur-next' },
    });

    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useDocumentList(undefined, { enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // 5 pages x 200 = the canonical ceiling; the cap must stay visible rather
    // than silently presenting a short list as a complete one.
    expect(client.listDocuments).toHaveBeenCalledTimes(5);
    expect(result.current.data?.items).toHaveLength(5);
    expect(result.current.data?.page.hasMore).toBe(true);
    queryClient.clear();
  });
});
