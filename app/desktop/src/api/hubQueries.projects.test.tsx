// #2290 regression suite for the Desktop workspace-projects query wrappers.
//
// Two things are pinned here, and both were live defects rather than hygiene:
//
// 1. Paging — `listWorkspaceProjects()` was called with no pageSize at all, so
//    the server applied its default of 50, and the returned page.nextCursor was
//    dropped. Every project past the first page was silently missing from the
//    desktop workbench: no "load more", no truncation hint, no error. The only
//    client code that ever advanced this cursor was the #1546
//    WorkbenchProjectsPort chain, which was structurally unreachable in both
//    shells and has been deleted.
//
// 2. Invalidation — the create/update mutations invalidated
//    `['hub','workspace-projects']`, a key that nothing ever registers (the
//    collection is keyed under the `projects` family). Prefix matching found no
//    cache entry, so creating or renaming a project left the desktop list stale
//    until something else happened to refetch it. Same failure mode as #2252 /
//    #2261, different family.
//
// Following the #2252 lesson, the key assertions below DERIVE the key from the
// hook and then require an observable refetch, so they cannot be satisfied by a
// key shape that only exists in this test file.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { createHubClient } from '@/api/hubClient';
import {
  fetchWorkspaceProjects,
  useCreateHubWorkspaceProject,
  useHubWorkspaceProjects,
  useUpdateHubWorkspaceProject,
} from './hubQueries';

vi.mock('@/api/hubClient', () => ({ createHubClient: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ getAccessToken: vi.fn(() => 'fixture-token') }));

function project(id: string, name: string) {
  return { id, name };
}

const client = {
  listWorkspaceProjects: vi.fn(),
  createWorkspaceProject: vi.fn(),
  updateWorkspaceProject: vi.fn(),
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createHubClient).mockReturnValue(client as never);
});

describe('desktop workspace project queries', () => {
  it('walks cursor pages so projects past the first page are visible', async () => {
    client.listWorkspaceProjects
      .mockResolvedValueOnce({
        items: [project('00000000-0000-0000-0000-00000000p101', 'Page 1 Project')],
        page: { hasMore: true, nextCursor: 'cur-1' },
      })
      .mockResolvedValueOnce({
        items: [project('00000000-0000-0000-0000-00000000p102', 'Page 2 Project')],
        page: { hasMore: false },
      });

    const res = await fetchWorkspaceProjects();

    expect(client.listWorkspaceProjects).toHaveBeenCalledTimes(2);
    // The first call must state the page size: passing nothing means the server
    // default (50), which is what hid the tail of the list.
    expect(client.listWorkspaceProjects).toHaveBeenNthCalledWith(1, { pageSize: 200 });
    expect(client.listWorkspaceProjects).toHaveBeenNthCalledWith(2, {
      pageSize: 200,
      pageCursor: 'cur-1',
    });
    expect(res.items.map((item) => item.name)).toEqual(['Page 1 Project', 'Page 2 Project']);
    expect(res.page.hasMore).toBe(false);
  });

  it('reports hasMore=true after exhausting the maximum cursor pages', async () => {
    client.listWorkspaceProjects.mockResolvedValue({
      items: [project('00000000-0000-0000-0000-00000000p301', 'Always More')],
      page: { hasMore: true, nextCursor: 'cur-next' },
    });

    const res = await fetchWorkspaceProjects();

    // The cap is a stated ceiling, not a silent one.
    expect(client.listWorkspaceProjects).toHaveBeenCalledTimes(5);
    expect(res.items).toHaveLength(5);
    expect(res.page.hasMore).toBe(true);
  });

  it('stops walking when the server omits a cursor even if hasMore is true', async () => {
    client.listWorkspaceProjects.mockResolvedValue({
      items: [project('00000000-0000-0000-0000-00000000p401', 'No Cursor')],
      page: { hasMore: true },
    });

    const res = await fetchWorkspaceProjects();

    expect(client.listWorkspaceProjects).toHaveBeenCalledTimes(1);
    expect(res.items).toHaveLength(1);
  });

  it('keys the collection off the shared projects family, not the bare root', async () => {
    client.listWorkspaceProjects.mockResolvedValue({
      items: [project('00000000-0000-0000-0000-00000000p501', 'Keyed')],
      page: { hasMore: false },
    });
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useHubWorkspaceProjects({ enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Derived from the real query cache (the convention in
    // sessionQueries.test.tsx), so this cannot pass on a key shape that only
    // exists in this file.
    const registered = queryClient.getQueryCache().findAll()
      .map((query) => [...query.queryKey] as unknown[]);
    expect(registered).toContainEqual([...hubQueryKeys.projects.list('hub')]);
    expect(registered).not.toContainEqual([...hubQueryKeys.projects.root]);
  });

  it.each([
    ['create', async (hooks: { create: () => Promise<unknown> }) => hooks.create()],
    ['update', async (hooks: { update: () => Promise<unknown> }) => hooks.update()],
  ])('the %s mutation invalidates a key the list query really occupies', async (_label, run) => {
    client.listWorkspaceProjects.mockResolvedValue({
      items: [project('00000000-0000-0000-0000-00000000p601', 'Before')],
      page: { hasMore: false },
    });
    client.createWorkspaceProject.mockResolvedValue(
      project('00000000-0000-0000-0000-00000000p602', 'Created'),
    );
    client.updateWorkspaceProject.mockResolvedValue(
      project('00000000-0000-0000-0000-00000000p601', 'Renamed'),
    );

    const { wrapper } = createWrapper();
    const list = renderHook(() => useHubWorkspaceProjects({ enabled: true }), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(client.listWorkspaceProjects).toHaveBeenCalledTimes(1);

    const mutations = renderHook(
      () => ({
        create: useCreateHubWorkspaceProject(),
        update: useUpdateHubWorkspaceProject(),
      }),
      { wrapper },
    );

    // An invalidation that matches nothing is indistinguishable from no
    // invalidation at all, so assert the observable consequence: the list
    // refetches. This is the assertion that would have caught
    // ['hub','workspace-projects'].
    await act(async () => {
      await run({
        create: () => mutations.result.current.create.mutateAsync({ name: 'Created' }),
        update: () =>
          mutations.result.current.update.mutateAsync({
            id: '00000000-0000-0000-0000-00000000p601',
            data: { name: 'Renamed' },
          }),
      });
    });

    await waitFor(() => expect(client.listWorkspaceProjects).toHaveBeenCalledTimes(2));
  });
});
