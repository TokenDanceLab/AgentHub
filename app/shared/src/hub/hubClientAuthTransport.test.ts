import { describe, expect, it, vi } from 'vitest';
import { createHubClient } from './hubClient';

describe('explicit Hub auth transport', () => {
  it('uses cookies and CSRF on unsafe JSON and multipart calls, never stale bearer or refresh', async () => {
    const fetch = vi.fn(async () => Response.json({ code: 'ok', data: {} }));
    const refresh = vi.fn();
    const client = createHubClient({
      baseUrl: 'https://hub.example.test', fetch,
      getToken: () => 'legacy-token', onRefreshToken: refresh,
      authTransport: { kind: 'browser-session', origin: 'https://hub.example.test', getCsrfToken: () => 'csrf-proof' },
    });
    await client.createWorkspaceProject({ name: 'Project' });
    await client.uploadAttachment(new File(['bytes'], 'file.txt'));
    for (const [, init] of fetch.mock.calls as unknown as [unknown, RequestInit][]) {
      expect(init.credentials).toBe('same-origin');
      expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).get('X-Hub-CSRF')).toBe('csrf-proof');
      expect(new Headers(init.headers).get('Authorization')).toBeNull();
    }
    expect(refresh).not.toHaveBeenCalled();
  });

  it('rejects an off-origin request before sending a credential or CSRF proof', async () => {
    const fetch = vi.fn();
    const client = createHubClient({ baseUrl: 'https://other.example.test', fetch,
      authTransport: { kind: 'browser-session', origin: 'https://hub.example.test', getCsrfToken: () => 'csrf-proof' },
    });
    await expect(client.me()).rejects.toThrow('application origin');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves the native bearer lane intact', async () => {
    const fetch = vi.fn(async () => Response.json({ code: 'ok', data: {} }));
    const client = createHubClient({ fetch,
      authTransport: { kind: 'bearer', getToken: () => 'native-token' },
    });
    await client.me();
    const init = (fetch.mock.calls as unknown as [unknown, RequestInit][])[0]![1];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer native-token');
    expect(init.credentials).toBeUndefined();
  });
});
