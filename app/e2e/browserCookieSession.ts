import type { Page } from '@playwright/test';

/** Keep browser cookies and CSRF proof inside the browser; return product data only. */
export async function browserHubJson(
  page: Page,
  method: 'get' | 'post' | 'delete',
  endpoint: string,
  data?: unknown,
): Promise<{ status: number; body: Record<string, any> | null }> {
  return page.evaluate(async ({ method, endpoint, data }) => {
    const url = new URL(endpoint, window.location.origin);
    if (url.origin !== window.location.origin) throw new Error('Web Hub API must use the application origin');
    const headers: Record<string, string> = {};
    if (method !== 'get') {
      const sessionResponse = await fetch('/client/auth/browser/session', { credentials: 'same-origin', redirect: 'error' });
      if (!sessionResponse.ok) return { status: sessionResponse.status, body: null };
      const session = (await sessionResponse.json()).data;
      headers['X-Hub-CSRF'] = session.csrf_token;
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url.href, {
      method: method.toUpperCase(), credentials: 'same-origin', redirect: 'error', headers,
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    const body = await response.json().catch(() => null);
    if (url.pathname === '/client/auth/browser/session' && body?.data) {
      body.data = { user: body.data.user, expires_at: body.data.expires_at };
    }
    return { status: response.status, body };
  }, { method, endpoint, data });
}
