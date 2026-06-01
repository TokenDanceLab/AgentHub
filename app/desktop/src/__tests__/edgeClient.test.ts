import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cancelRun,
  createThread,
  fetchHealth,
  fetchRunners,
  fetchThreadItems,
  startRun,
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
});
