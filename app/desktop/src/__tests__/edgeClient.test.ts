import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchHealth,
  fetchRunners,
  startRun,
  cancelRun,
  decidePermission,
  archiveThread,
  deleteThread,
  updateThreadStatus,
  renameThread,
  createThread,
  fetchThreadItems,
  fetchRunDiff,
  fetchArtifacts,
  fetchPreviews,
} from '../api/edgeClient';

describe('edgeClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('fetchHealth', () => {
    it('returns health response on success', async () => {
      const mock = { status: 'ok', version: 'v1', edgeId: 'local' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mock),
      } as Response);

      const result = await fetchHealth();
      expect(result).toEqual(mock);
    });

    it('throws AppError on failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: { code: 'internal_error', message: 'boom' } }),
      } as Response);

      await expect(fetchHealth()).rejects.toThrow('boom');
    });
  });

  describe('fetchRunners', () => {
    it('returns runner list', async () => {
      const mock = {
        items: [{ id: 'runner_local_1', name: 'Mock Runner', status: 'online' }],
        page: { hasMore: false },
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mock),
      } as Response);

      const result = await fetchRunners();
      expect(result.items).toHaveLength(1);
      expect(result.page.hasMore).toBe(false);
    });
  });

  describe('threads', () => {
    it('creates a thread with explicit project, title, and thread id', async () => {
      const mock = {
        threadId: 'thread_manual',
        projectId: 'proj_local',
        title: 'Manual thread',
        status: 'active',
        createdAt: '2026-05-26T00:00:00Z',
        updatedAt: '2026-05-26T00:00:00Z',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mock),
      } as Response);

      const result = await createThread({
        projectId: 'proj_local',
        threadId: 'thread_manual',
        title: 'Manual thread',
      });

      expect(result.threadId).toBe('thread_manual');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/threads$/),
        expect.objectContaining({
          body: JSON.stringify({
            projectId: 'proj_local',
            threadId: 'thread_manual',
            title: 'Manual thread',
          }),
          method: 'POST',
        }),
      );
    });

    it('fetches thread items with Edge auth headers', async () => {
      localStorage.setItem('agenthub:edge_auth_token', 'local-edge-token');
      const mock = {
        items: [
          {
            itemId: 'item_1',
            projectId: 'proj_local',
            threadId: 'thread_1',
            type: 'message',
            role: 'user',
            status: 'created',
            content: 'hello',
            createdAt: '2026-05-26T00:00:00Z',
            updatedAt: '2026-05-26T00:00:00Z',
          },
        ],
        page: { hasMore: false },
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mock),
      } as Response);

      const result = await fetchThreadItems('thread_1');

      expect(result.items[0]?.itemId).toBe('item_1');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/threads\/thread_1\/items$/),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer local-edge-token',
          }),
        }),
      );
    });
  });

  describe('startRun', () => {
    it('posts and returns run info', async () => {
      const mock = { runId: 'run_abc123', status: 'queued' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mock),
      } as Response);

      const result = await startRun();
      expect(result.runId).toMatch(/^run_/);
      expect(result.status).toBe('queued');
    });

    it('sends Edge auth token when one is stored locally', async () => {
      localStorage.setItem('agenthub:edge_auth_token', 'local-edge-token');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ runId: 'run_abc123', status: 'queued' }),
      } as Response);

      await startRun();

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/runs$/),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer local-edge-token',
          }),
        }),
      );
    });

    it('preserves model routing metadata in the request body', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ runId: 'run_abc123', status: 'queued' }),
      } as Response);

      await startRun({
        prompt: 'route this',
        model: 'claude-opus-4-7',
        provider: 'anthropic',
        modelAlias: 'opus',
        modelMappingEnabled: true,
        providerFallbackEnabled: true,
        reasoningEffort: 'max',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/runs$/),
        expect.objectContaining({
          body: JSON.stringify({
            prompt: 'route this',
            model: 'claude-opus-4-7',
            provider: 'anthropic',
            modelAlias: 'opus',
            modelMappingEnabled: true,
            providerFallbackEnabled: true,
            reasoningEffort: 'max',
          }),
        }),
      );
    });

    it('preserves threadId in the request body', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ runId: 'run_abc123', status: 'queued', threadId: 'thread-1' }),
      } as Response);

      await startRun({
        prompt: 'continue thread',
        threadId: 'thread-1',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/runs$/),
        expect.objectContaining({
          body: JSON.stringify({
            prompt: 'continue thread',
            threadId: 'thread-1',
          }),
        }),
      );
    });
  });

  describe('cancelRun', () => {
    it('posts cancel and returns status', async () => {
      const mock = { runId: 'run_abc123', status: 'cancelling' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mock),
      } as Response);

      const result = await cancelRun('run_abc123');
      expect(result.runId).toBe('run_abc123');
      expect(result.status).toBe('cancelling');
    });

    it('URL-encodes the runId', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ runId: 'run_x', status: 'cancelling' }),
      } as Response);

      await cancelRun('run_x');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/runs\/run_x:cancel$/),
        expect.anything(),
      );
    });
  });

  describe('decidePermission', () => {
    it('posts the run-scoped permission decision to Local Edge', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
      } as Response);

      await decidePermission({
        runId: 'run_abc123',
        requestId: 'perm_1',
        decision: 'allow',
        reason: 'review panel',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/permissions\/decide$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            runId: 'run_abc123',
            requestId: 'perm_1',
            decision: 'allow',
            reason: 'review panel',
          }),
        }),
      );
    });

    it('rejects duplicate or expired permission decisions without local success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({
          error: {
            code: 'permission_request_not_found',
            message: 'permission request not found',
          },
        }),
      } as Response);

      await expect(decidePermission({
        runId: 'run_abc123',
        requestId: 'perm_missing',
        decision: 'deny',
      })).rejects.toMatchObject({
        code: 'permission_request_not_found',
        status: 404,
      });
    });
  });

  describe('run evidence', () => {
    it('fetches run diff from the run-scoped Edge source', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          runId: 'run_abc123',
          files: [{ path: 'src/app.ts', diff: '@@ -1 +1 @@\n-old\n+new', status: 'modified' }],
        }),
      } as Response);

      const result = await fetchRunDiff('run_abc123');

      expect(result.files[0]?.path).toBe('src/app.ts');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/runs\/run_abc123\/diff$/),
        expect.anything(),
      );
    });

    it('fetches artifact and preview lists without run-local fake paths', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            items: [{
              id: 'artifact-1',
              runId: 'run_abc123',
              threadId: 'thread-1',
              kind: 'patch',
              path: 'changes.diff',
              sizeBytes: 12,
              createdAt: '2026-01-01T00:00:00Z',
            }],
            page: { hasMore: false },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            items: [{
              id: 'preview-1',
              runId: 'run_abc123',
              threadId: 'thread-1',
              url: 'http://127.0.0.1:4173',
              status: 'ready',
              createdAt: '2026-01-01T00:00:00Z',
            }],
            page: { hasMore: false },
          }),
        } as Response);

      await expect(fetchArtifacts()).resolves.toMatchObject({ items: [{ id: 'artifact-1' }] });
      await expect(fetchPreviews()).resolves.toMatchObject({ items: [{ id: 'preview-1' }] });
      expect(fetchSpy).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/v1\/artifacts$/), expect.anything());
      expect(fetchSpy).toHaveBeenNthCalledWith(2, expect.stringMatching(/\/v1\/previews$/), expect.anything());
    });
  });

  describe('thread status actions', () => {
    it('renames a thread through the real patch endpoint', async () => {
      const thread = {
        threadId: 'thread_abc',
        projectId: 'proj_local',
        title: 'Repair message ordering',
        status: 'active',
        createdAt: '2026-05-29T00:00:00Z',
        updatedAt: '2026-05-29T00:01:00Z',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(thread),
      } as Response);

      const result = await renameThread('thread_abc', 'Repair message ordering');

      expect(result.title).toBe('Repair message ordering');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/threads\/thread_abc$/),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Repair message ordering' }),
        }),
      );
    });

    it('archives a thread through the real archive endpoint', async () => {
      const thread = {
        threadId: 'thread_abc',
        projectId: 'proj_local',
        title: 'Archive me',
        status: 'archived',
        createdAt: '2026-05-29T00:00:00Z',
        updatedAt: '2026-05-29T00:01:00Z',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(thread),
      } as Response);

      const result = await archiveThread('thread_abc');

      expect(result.status).toBe('archived');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/threads\/thread_abc:archive$/),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('restores a thread by patching status active', async () => {
      const thread = {
        threadId: 'thread_abc',
        projectId: 'proj_local',
        title: 'Restore me',
        status: 'active',
        createdAt: '2026-05-29T00:00:00Z',
        updatedAt: '2026-05-29T00:02:00Z',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(thread),
      } as Response);

      const result = await updateThreadStatus('thread_abc', 'active');

      expect(result.status).toBe('active');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/threads\/thread_abc$/),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'active' }),
        }),
      );
    });

    it('falls back to archive when the running Edge does not allow DELETE', async () => {
      const archivedThread = {
        threadId: 'thread_abc',
        projectId: 'proj_local',
        title: 'Delete fallback',
        status: 'archived',
        createdAt: '2026-05-29T00:00:00Z',
        updatedAt: '2026-05-29T00:03:00Z',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 405,
          statusText: 'Method Not Allowed',
          json: () => Promise.resolve({ error: { code: 'method_not_allowed', message: 'method not allowed' } }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(archivedThread),
        } as Response);

      const result = await deleteThread('thread_abc');

      expect(result).toBe('archived');
      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(/\/v1\/threads\/thread_abc$/),
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/\/v1\/threads\/thread_abc:archive$/),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('thread status actions', () => {
    it('renames a thread through the real patch endpoint', async () => {
      const thread = {
        threadId: 'thread_abc',
        projectId: 'proj_local',
        title: 'Repair message ordering',
        status: 'active',
        createdAt: '2026-05-29T00:00:00Z',
        updatedAt: '2026-05-29T00:01:00Z',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(thread),
      } as Response);

      const result = await renameThread('thread_abc', 'Repair message ordering');

      expect(result.title).toBe('Repair message ordering');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/threads\/thread_abc$/),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Repair message ordering' }),
        }),
      );
    });

    it('archives a thread through the real archive endpoint', async () => {
      const thread = {
        threadId: 'thread_abc',
        projectId: 'proj_local',
        title: 'Archive me',
        status: 'archived',
        createdAt: '2026-05-29T00:00:00Z',
        updatedAt: '2026-05-29T00:01:00Z',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(thread),
      } as Response);

      const result = await archiveThread('thread_abc');

      expect(result.status).toBe('archived');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/threads\/thread_abc:archive$/),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('restores a thread by patching status active', async () => {
      const thread = {
        threadId: 'thread_abc',
        projectId: 'proj_local',
        title: 'Restore me',
        status: 'active',
        createdAt: '2026-05-29T00:00:00Z',
        updatedAt: '2026-05-29T00:02:00Z',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(thread),
      } as Response);

      const result = await updateThreadStatus('thread_abc', 'active');

      expect(result.status).toBe('active');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/threads\/thread_abc$/),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'active' }),
        }),
      );
    });

    it('falls back to archive when the running Edge does not allow DELETE', async () => {
      const archivedThread = {
        threadId: 'thread_abc',
        projectId: 'proj_local',
        title: 'Delete fallback',
        status: 'archived',
        createdAt: '2026-05-29T00:00:00Z',
        updatedAt: '2026-05-29T00:03:00Z',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 405,
          statusText: 'Method Not Allowed',
          json: () => Promise.resolve({ error: { code: 'method_not_allowed', message: 'method not allowed' } }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(archivedThread),
        } as Response);

      const result = await deleteThread('thread_abc');

      expect(result).toBe('archived');
      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(/\/v1\/threads\/thread_abc$/),
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/\/v1\/threads\/thread_abc:archive$/),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
