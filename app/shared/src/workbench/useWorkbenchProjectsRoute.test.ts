import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectInfo } from './pages';
import {
  useWorkbenchProjectsRoute,
  type WorkbenchProjectsStatus,
} from './useWorkbenchProjectsRoute';
import type { WorkbenchProjectsPage, WorkbenchProjectsPort } from './workbenchProjectsPort';

/* ═══════════════════════════════════════════════════════════════════════
   useWorkbenchProjectsRoute — port-driven data mode (#1546).

   Covers the internal-fetching branch (projectsPort injected, parent does
   not manage `projects`): initial load, create/update, load-more cursor
   advance, visible load-more failure + explicit retry, mock fallback in
   fixture mode, parent-managed precedence, and unmount safety.
   ═══════════════════════════════════════════════════════════════════════ */

function project(id: string, name = `Project ${id}`): ProjectInfo {
  return {
    id,
    name,
    description: `${name} description`,
    status: 'Active',
    meta: 'Hub project',
    members: [],
    announcement: '',
    runs: [],
    artifacts: [],
    feed: [],
  };
}

function createPort(overrides: Partial<WorkbenchProjectsPort> = {}): WorkbenchProjectsPort {
  const pages: Record<string, { items: ProjectInfo[]; nextCursor?: string; hasMore: boolean }> = {
    first: { items: [project('p1'), project('p2')], nextCursor: 'cursor-2', hasMore: true },
    'cursor-2': { items: [project('p3')], hasMore: false },
  };
  return {
    listProjects: vi.fn(async (params?: { pageSize?: number; pageCursor?: string }) => {
      const key = params?.pageCursor ?? 'first';
      const page = pages[key] ?? { items: [], hasMore: false };
      return { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore };
    }),
    createProject: vi.fn(async (draft) => project('created', draft.name.trim() || 'Untitled Project')),
    updateProject: vi.fn(async (projectId, draft) => project(projectId, draft.name.trim() || projectId)),
    ...overrides,
  };
}

describe('useWorkbenchProjectsRoute — port-driven mode', () => {
  it('loads the first page from the port and exposes pagination state', async () => {
    const port = createPort();
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projectsPort: port,
      realDataMode: true,
    }));

    await waitFor(() => {
      expect(result.current.sourceProjects).toHaveLength(2);
    });
    expect(port.listProjects).toHaveBeenCalledWith({ pageSize: 50 });
    expect(result.current.effectiveProjectsStatus?.loading).toBe(false);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.loadMoreError).toBeUndefined();
    expect(result.current.loadMore).toBeTypeOf('function');
  });

  it('appends the next page with the cursor and stops at the last page', async () => {
    const port = createPort();
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projectsPort: port,
      realDataMode: true,
    }));
    await waitFor(() => {
      expect(result.current.sourceProjects).toHaveLength(2);
    });

    act(() => {
      result.current.loadMore?.();
    });
    await waitFor(() => {
      expect(result.current.sourceProjects).toHaveLength(3);
    });
    expect(port.listProjects).toHaveBeenLastCalledWith({
      pageSize: 50,
      pageCursor: 'cursor-2',
    });
    expect(result.current.hasMore).toBe(false);
  });

  it('surfaces load-more failures visibly and stops the sentinel, then retries explicitly', async () => {
    const listProjects = vi.fn(async (
      params?: { pageSize?: number; pageCursor?: string },
    ): Promise<WorkbenchProjectsPage> => {
      if (params?.pageCursor === 'cursor-2') {
        throw new Error('pagination exploded');
      }
      return {
        items: [project('p1')],
        nextCursor: 'cursor-2',
        hasMore: true,
      };
    });
    const port = createPort({ listProjects });
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projectsPort: port,
      realDataMode: true,
    }));
    await waitFor(() => {
      expect(result.current.sourceProjects).toHaveLength(1);
    });

    act(() => {
      result.current.loadMore?.();
    });
    await waitFor(() => {
      expect(result.current.loadMoreError).toBe('pagination exploded');
    });
    // Failure stops auto-retry: hasMore flips to false so the scroll sentinel disconnects.
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingMore).toBe(false);

    // The retry path re-enters loadMore, clears the error and fetches again.
    listProjects.mockImplementationOnce(async () => ({
      items: [project('p2')],
      hasMore: false,
    }));
    act(() => {
      result.current.loadMore?.();
    });
    await waitFor(() => {
      expect(result.current.sourceProjects).toHaveLength(2);
    });
    expect(result.current.loadMoreError).toBeUndefined();
    expect(result.current.hasMore).toBe(false);
  });

  it('reports initial load errors through projectsStatus', async () => {
    const port = createPort({
      listProjects: vi.fn(async () => {
        throw new Error('initial exploded');
      }),
    });
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projectsPort: port,
      realDataMode: true,
    }));

    await waitFor(() => {
      expect(result.current.effectiveProjectsStatus?.error).toBe('initial exploded');
    });
    expect(result.current.effectiveProjectsStatus?.loading).toBe(false);
    expect(result.current.sourceProjects).toEqual([]);
  });

  it('creates and updates through the port and refreshes the list', async () => {
    const port = createPort();
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projectsPort: port,
      realDataMode: true,
    }));
    await waitFor(() => {
      expect(result.current.sourceProjects).toHaveLength(2);
    });

    await act(async () => {
      const created = await result.current.handleProjectCreate({ name: '  New  ', description: '' });
      expect(created?.name).toBe('New');
    });
    expect(port.createProject).toHaveBeenCalledWith({ name: '  New  ', description: '' });
    await waitFor(() => {
      // createProject returns the created item; loadProjects refetches afterwards.
      expect(port.listProjects).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      await result.current.handleProjectUpdate('p1', { name: 'Renamed', description: 'd' });
    });
    expect(port.updateProject).toHaveBeenCalledWith('p1', { name: 'Renamed', description: 'd' });
    await waitFor(() => {
      expect(port.listProjects).toHaveBeenCalledTimes(3);
    });
  });

  it('surfaces create/update failures as actionError and rethrows', async () => {
    const port = createPort({
      createProject: vi.fn(async () => {
        throw new Error('create exploded');
      }),
    });
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projectsPort: port,
      realDataMode: true,
    }));
    await waitFor(() => {
      expect(result.current.sourceProjects).toHaveLength(2);
    });

    await act(async () => {
      await expect(
        result.current.handleProjectCreate({ name: 'New', description: '' }),
      ).rejects.toThrow('create exploded');
    });
    expect(result.current.effectiveProjectsStatus?.actionError).toBe('create exploded');
    expect(result.current.effectiveProjectsStatus?.saving).toBe(false);
  });

  it('prefers parent-managed projects and keeps the port dormant', async () => {
    const port = createPort();
    const managedStatus: WorkbenchProjectsStatus = { loading: true };
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projects: [project('managed')],
      projectsStatus: managedStatus,
      projectsPort: port,
      realDataMode: true,
    }));

    expect(result.current.sourceProjects).toHaveLength(1);
    expect(result.current.effectiveProjectsStatus).toBe(managedStatus);
    expect(result.current.loadMore).toBeUndefined();
    expect(port.listProjects).not.toHaveBeenCalled();
  });

  it('falls back to mock projects in fixture mode when no port is injected', () => {
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      realDataMode: false,
    }));
    expect(result.current.sourceProjects.length).toBeGreaterThan(0);
    expect(result.current.effectiveProjectsStatus).toBeUndefined();
    expect(result.current.loadMore).toBeUndefined();
  });

  it('shows an empty list in real mode when no port is injected', () => {
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      realDataMode: true,
    }));
    expect(result.current.sourceProjects).toEqual([]);
    expect(result.current.loadMore).toBeUndefined();
  });

  it('does not write stale state after unmount', async () => {
    let resolveList!: (value: WorkbenchProjectsPage) => void;
    const port = createPort({
      listProjects: vi.fn((...args) => new Promise<WorkbenchProjectsPage>((resolve) => {
        resolveList = resolve;
      })),
    });
    const { result, unmount } = renderHook(() => useWorkbenchProjectsRoute({
      projectsPort: port,
      realDataMode: true,
    }));

    unmount();
    await act(async () => {
      resolveList({ items: [project('late')], hasMore: false });
    });
    // Unmounted: the late response must not be written into sourceProjects.
    expect(result.current.sourceProjects).toEqual([]);
  });

  it('does not append duplicate pages when a load-more is already in flight', async () => {
    let releaseFirst!: () => void;
    const listProjects = vi.fn(async (params?: { pageSize?: number; pageCursor?: string }) => {
      if (params?.pageCursor === 'cursor-2') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return { items: [project('p3')], nextCursor: undefined, hasMore: false };
      }
      return { items: [project('p1')], nextCursor: 'cursor-2', hasMore: true };
    });
    const port = createPort({ listProjects });
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projectsPort: port,
      realDataMode: true,
    }));
    await waitFor(() => {
      expect(result.current.sourceProjects).toHaveLength(1);
    });

    act(() => {
      result.current.loadMore?.();
      result.current.loadMore?.();
    });
    await act(async () => {
      releaseFirst();
    });
    await waitFor(() => {
      expect(result.current.sourceProjects).toHaveLength(2);
    });
    // The second call was suppressed by the in-flight guard.
    expect(listProjects).toHaveBeenCalledTimes(2);
  });
});
