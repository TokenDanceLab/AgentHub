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

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/web/projects/project%2Fid/threads',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/web/projects/project%2Fid/threads',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: '新项目群' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/web/projects/project%2Fid/threads/thread%2Fid/messages?limit=80',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hub-access' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/web/projects/project%2Fid/threads/thread%2Fid/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_msg_id: 'client-message-2',
          content_type: 'text',
          content: JSON.stringify(a2aContent),
        }),
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
});
