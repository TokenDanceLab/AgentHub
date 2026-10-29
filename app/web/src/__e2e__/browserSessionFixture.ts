import { expect, type Page, type Request } from '@playwright/test';

export const BROWSER_FIXTURE_ORIGIN = `http://127.0.0.1:${Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5184)}`;
const CSRF_PROOF = 'fixture-csrf-proof';

/** Fixture only: this is not real Account login or real Hub session evidence. */
export function browserSessionFixture(user: unknown) {
  return { user, csrf_token: CSRF_PROOF, expires_at: '2099-01-01T00:00:00Z' };
}

export async function installBrowserSessionFixture(page: Page): Promise<void> {
  await page.context().addCookies([{
    name: 'agenthub_browser_session', value: 'fixture-session', url: BROWSER_FIXTURE_ORIGIN,
    httpOnly: true, sameSite: 'Lax', secure: false,
  }]);
  await page.routeWebSocket(`${BROWSER_FIXTURE_ORIGIN.replace('http:', 'ws:')}/client/ws`, (socket) => {
    socket.send(JSON.stringify({ type: 'auth.ok', payload: null }));
  });
}

export function assertBrowserFixtureRequest(request: Request): void {
  expect(new URL(request.url()).origin).toBe(BROWSER_FIXTURE_ORIGIN);
  expect(request.headers()['authorization']).toBeUndefined();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    && !/\/browser\/(authorize|callback)$/.test(new URL(request.url()).pathname)) {
    expect(request.headers()['x-hub-csrf']).toBe(CSRF_PROOF);
  }
}
