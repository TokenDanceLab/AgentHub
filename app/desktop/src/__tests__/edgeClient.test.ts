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
    it('posts a run-scoped permission decision to Edge', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      } as Response);

      await decidePermission({
        runId: 'run_abc123',
        requestId: 'perm_1',
        decision: 'deny',
        reason: 'test denial',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/v1\/permissions\/decide$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            runId: 'run_abc123',
            requestId: 'perm_1',
            decision: 'deny',
            reason: 'test denial',
          }),
        }),
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
