// Desktop host runtime-sessions fetch (#1192): the Edge REST path lives on
// the Desktop platform adapter; shared consumes the data through
// `HostDiagnosticsPort.listRuntimeSessions`.
import { describe, expect, it, vi } from 'vitest';
import { fetchDesktopRuntimeSessions } from './desktopRuntimeSessions';

describe('fetchDesktopRuntimeSessions', () => {
  it('unwraps Edge success envelope', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'OK',
        data: {
          items: [
            {
              id: 'a',
              runtime: 'claude-code',
              title: 'a',
              sourceMode: 'import',
              updatedAt: '2026-07-19T01:00:00Z',
            },
          ],
        },
      }),
    })) as unknown as typeof fetch;

    const items = await fetchDesktopRuntimeSessions({
      edgeBaseUrl: 'http://127.0.0.1:3210',
      limit: 5,
      fetchImpl,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.sourceMode).toBe('import');
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:3210/v1/runtime-sessions?limit=5');
  });

  it('rejects when the Edge endpoint fails', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(
      fetchDesktopRuntimeSessions({
        edgeBaseUrl: 'http://127.0.0.1:3210',
        fetchImpl,
      }),
    ).rejects.toThrow('Edge GET /v1/runtime-sessions failed: 502');
  });
});
