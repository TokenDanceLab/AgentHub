import { describe, expect, it, vi } from 'vitest';
import { createHubClient } from './hubClient';

describe('Edge enrollment browser API', () => {
  it('uses only the short code and device id with cookie and CSRF transport', async () => {
    const fetch = vi.fn(async () => Response.json({ code: 'ok', data: { status: 'confirmed' } }));
    const client = createHubClient({ baseUrl: 'https://hub.example.test', fetch,
      authTransport: { kind: 'browser-session', origin: 'https://hub.example.test', getCsrfToken: () => 'csrf-proof' },
    });
    await client.previewEdgeEnrollment('ABCDE-FG234');
    await client.confirmEdgeEnrollment('ABCDE-FG234');
    await client.revokeEdgeDevice('device/id');
    await client.cancelAgentTask('task-1');
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/web/edge-enrollments/preview', '/web/edge-enrollments/confirm', '/web/edge-devices/device%2Fid/revoke',
      '/web/agent-tasks/task-1:cancel',
    ]);
    expect(calls[0]![1].method).toBe('POST');
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ user_code: 'ABCDE-FG234' });
    expect(calls.every(([url]) => !url.includes('ABCDE-FG234'))).toBe(true);
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ user_code: 'ABCDE-FG234' });
    expect(calls[2]![1].method).toBe('POST');
    for (const [, init] of calls) {
      expect(init.credentials).toBe('same-origin');
      expect(new Headers(init.headers).get('Authorization')).toBeNull();
      if (init.method === 'POST') expect(new Headers(init.headers).get('X-Hub-CSRF')).toBe('csrf-proof');
    }
  });
});
