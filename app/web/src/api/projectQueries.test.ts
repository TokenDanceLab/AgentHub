import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from '@/hooks/useAuth';
import {
  createWorkspaceProjectThread,
  fetchWorkspaceProjectThreadMessages,
  fetchWorkspaceProjectThreads,
  createWorkspaceProject,
  fetchWorkspaceProject,
  fetchWorkspaceProjects,
  sendWorkspaceProjectThreadMessage,
  updateWorkspaceProject,
} from './projectQueries';

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: vi.fn(),
}));


function getHeader(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const hit = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return hit?.[1] ?? null;
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

function getCallInit(calls: readonly unknown[][], index: number): RequestInit {
  const call = calls[index];
  expect(call).toBeDefined();
  const init = call![1];
  expect(init).toBeDefined();
  return init as unknown as RequestInit;
}

describe('web project queries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(getAccessToken).mockReturnValue(null);
  });

  it('lists Hub workspace projects through /web/projects when a Hub session token is available', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8080/web/projects?pageSize=200');
      expect(getHeader(init, 'Authorization')).toBe('Bearer hub-access');
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

  // #2290: the endpoint has always supported pageCursor and always returned
  // page.nextCursor, but this call site asked for one page and dropped the
  // cursor, so every project past the first page was silently invisible. These
  // two pin the walk and the honest cap; the shape mirrors
  // executionTargetQueries.test.ts so the front end keeps one paging idiom.
  it('walks cursor pages so projects past the first page are visible', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            items: [{
              id: '00000000-0000-0000-0000-00000000p101',
              name: 'Page 1 Project',
            }],
            page: { hasMore: true, nextCursor: 'cur-1' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            items: [{
              id: '00000000-0000-0000-0000-00000000p102',
              name: 'Page 2 Project',
            }],
            page: { hasMore: false },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWorkspaceProjects(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://localhost:8080/web/projects?pageSize=200');
    expect(String(fetchMock.mock.calls[1]?.[0]))
      .toBe('http://localhost:8080/web/projects?pageSize=200&pageCursor=cur-1');
    expect(res.items.map((item) => item.name)).toEqual(['Page 1 Project', 'Page 2 Project']);
    expect(res.page.hasMore).toBe(false);
  });

  it('reports hasMore=true after exhausting the maximum cursor pages', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        code: 'ok',
        data: {
          items: [{
            id: '00000000-0000-0000-0000-00000000p301',
            name: 'Always More',
          }],
          page: { hasMore: true, nextCursor: 'cur-next' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWorkspaceProjects(true);

    // The cap is a stated ceiling, not a silent one: the caller can still tell
    // that the list was truncated.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(res.items).toHaveLength(5);
    expect(res.page.hasMore).toBe(true);
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

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8080/web/projects/project%2Fid');
    expect(getHeader(getCallInit(fetchMock.mock.calls, 0), 'Authorization')).toBe('Bearer hub-access');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://localhost:8080/web/projects');
    expect(getCallInit(fetchMock.mock.calls, 1).method).toBe('POST');
    expect(getCallInit(fetchMock.mock.calls, 1).body).toBe(
      JSON.stringify({ name: 'Created Project', description: 'Created from Web' }),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://localhost:8080/web/projects/project%2Fid');
    expect(getCallInit(fetchMock.mock.calls, 2).method).toBe('PATCH');
    expect(getCallInit(fetchMock.mock.calls, 2).body).toBe(
      JSON.stringify({ name: 'Updated Project', description: 'Updated from Web' }),
    );
    expect(detail).toMatchObject({ name: 'Existing Project' });
    expect(created).toMatchObject({ id: 'created-project' });
    expect(updated).toMatchObject({ name: 'Updated Project' });
  });

  it('fetches and sends Project Group @Agent messages through Hub project thread routes', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    const a2aContent = {
      text: '@Reviewer 请审查这个切片',
      metadata: {
        im_kind: 'project_group',
        mentions: [{ type: 'agent', id: 'agent-reviewer', display_name: 'Reviewer' }],
        orchestrator_queue: { status: 'queued', route: 'review', correlation_id: 'corr-1' },
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/web/projects/project%2Fid/threads') && !init?.method) {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: [{
              id: 'thread-1',
              project_id: 'project/id',
              type: 'group',
              name: '项目群',
              role: 'owner',
              member_count: 3,
              created_at: '2026-06-09T01:00:00Z',
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/web/projects/project%2Fid/threads') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: {
              id: 'thread-2',
              project_id: 'project/id',
              type: 'group',
              name: '新项目群',
              member_count: 1,
              created_at: '2026-06-09T01:01:00Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/web/projects/project%2Fid/threads/thread%2Fid/messages?limit=80') && !init?.method) {
        return new Response(
          JSON.stringify({
            code: 'ok',
            data: [{
              id: 'message-1',
              project_id: 'project/id',
              thread_id: 'thread/id',
              seq_id: 1,
              client_msg_id: 'client-message-1',
              sender_type: 'user',
              sender_id: 'user-1',
              content_type: 'text',
              content: JSON.stringify(a2aContent),
              created_at: '2026-06-09T01:02:00Z',
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          code: 'ok',
          data: {
            id: 'message-2',
            project_id: 'project/id',
            thread_id: 'thread/id',
            seq_id: 2,
            client_msg_id: 'client-message-2',
            sender_type: 'user',
            sender_id: 'user-1',
            content_type: 'text',
            content: JSON.stringify(a2aContent),
            created_at: '2026-06-09T01:03:00Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const threads = await fetchWorkspaceProjectThreads('project/id');
    const createdThread = await createWorkspaceProjectThread('project/id', { name: '新项目群' });
    const messages = await fetchWorkspaceProjectThreadMessages('project/id', 'thread/id');
    const sent = await sendWorkspaceProjectThreadMessage('project/id', 'thread/id', {
      client_msg_id: 'client-message-2',
      content_type: 'text',
      content: JSON.stringify(a2aContent),
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:8080/web/projects/project%2Fid/threads',
    );
    expect(getHeader(getCallInit(fetchMock.mock.calls, 0), 'Authorization')).toBe('Bearer hub-access');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://localhost:8080/web/projects/project%2Fid/threads',
    );
    expect(getCallInit(fetchMock.mock.calls, 1).method).toBe('POST');
    expect(getCallInit(fetchMock.mock.calls, 1).body).toBe(
      JSON.stringify({ name: '新项目群' }),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'http://localhost:8080/web/projects/project%2Fid/threads/thread%2Fid/messages?limit=80',
    );
    expect(getHeader(getCallInit(fetchMock.mock.calls, 2), 'Authorization')).toBe('Bearer hub-access');
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      'http://localhost:8080/web/projects/project%2Fid/threads/thread%2Fid/messages',
    );
    expect(getCallInit(fetchMock.mock.calls, 3).method).toBe('POST');
    expect(getCallInit(fetchMock.mock.calls, 3).body).toBe(
      JSON.stringify({
        client_msg_id: 'client-message-2',
        content_type: 'text',
        content: JSON.stringify(a2aContent),
      }),
    );
    expect(threads[0]).toMatchObject({ id: 'thread-1', name: '项目群', member_count: 3 });
    expect(createdThread).toMatchObject({ id: 'thread-2', name: '新项目群' });
    expect(JSON.parse(messages[0]!.content).metadata).toMatchObject({
      im_kind: 'project_group',
      mentions: [{ id: 'agent-reviewer' }],
      orchestrator_queue: { status: 'queued' },
    });
    expect(sent).toMatchObject({ id: 'message-2', thread_id: 'thread/id' });
  });

  it('does not request Project Group threads or messages when Hub auth is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const threads = await fetchWorkspaceProjectThreads('project/id');
    const messages = await fetchWorkspaceProjectThreadMessages('project/id', 'thread/id');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(threads).toEqual([]);
    expect(messages).toEqual([]);
  });

  it('surfaces 401 unauthorized from project list as AppError (fail-closed)', async () => {
    vi.mocked(getAccessToken).mockReturnValue('stale-token');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 'unauthorized', message: 'bad token' }),
      { status: 401, statusText: 'Unauthorized', headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(fetchWorkspaceProjects(true)).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'bad token',
      status: 401,
    });
  });

  it('surfaces 404 from project detail as AppError', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 'NOT_FOUND', message: 'project missing' }),
      { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(fetchWorkspaceProject('project/id')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('surfaces 500 from project list as AppError', async () => {
    vi.mocked(getAccessToken).mockReturnValue('hub-access');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 'INTERNAL_ERROR', message: 'hub down' }),
      { status: 500, statusText: 'Internal Server Error', headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(fetchWorkspaceProjects(true)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    });
  });

  it('rejects project create without a Hub session token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(createWorkspaceProject({ name: 'x' })).rejects.toThrow('Hub session is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
