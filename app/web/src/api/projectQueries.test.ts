import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from '@/hooks/useAuth';
import {
  createWorkspaceProject,
  fetchWorkspaceProject,
  fetchWorkspaceProjects,
  updateWorkspaceProject,
} from './projectQueries';

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: vi.fn(),
}));

describe('web project queries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(getAccessToken).mockReturnValue(null);
  });

  it('lists Hub workspace projects through /web/projects when a Hub session token is available', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8080/web/projects?pageSize=50');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer hub-access' });
      return new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            items: [
              {
                id: '00000000-0000-0000-0000-00000000p201',
                name: 'AgentHub Web',
                description: 'Hub project list item',
              },
            ],
            page: { hasMore: false },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWorkspaceProjects(true);

    expect(res.items).toEqual([
      expect.objectContaining({
        id: '00000000-0000-0000-0000-00000000p201',
        name: 'AgentHub Web',
      }),
    ]);
  });

  it('does not fall back to static project previews when Hub auth is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWorkspaceProjects(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.items).toEqual([]);
    expect(res.page.hasMore).toBe(false);
  });

  it('gets, creates, and updates Hub workspace projects through the owner-scoped contract', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/web/projects/project%2Fid') && !init?.method) {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: {
              id: 'project/id',
              name: 'Existing Project',
              description: 'Loaded from Hub detail',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/web/projects') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: {
              id: 'created-project',
              name: 'Created Project',
              description: 'Created from Web',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            id: 'project/id',
            name: 'Updated Project',
            description: 'Updated from Web',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const detail = await fetchWorkspaceProject('project/id');
    const created = await createWorkspaceProject({
      name: 'Created Project',
      description: 'Created from Web',
    });
    const updated = await updateWorkspaceProject('project/id', {
      name: 'Updated Project',
      description: 'Updated from Web',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/web/projects/project%2Fid',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/web/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Created Project', description: 'Created from Web' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/web/projects/project%2Fid',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Project', description: 'Updated from Web' }),
      }),
    );
    expect(detail).toMatchObject({ name: 'Existing Project' });
    expect(created).toMatchObject({ id: 'created-project' });
    expect(updated).toMatchObject({ name: 'Updated Project' });
  });
});
