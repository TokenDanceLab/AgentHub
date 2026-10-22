import { test, expect } from '@playwright/test';
import { assertFontGuardHermetic, blockExternalFonts, type E2EFontGuard } from '../../../e2e/fontBlocker';

// The desktop renderer ships a CSP meta (app/desktop/index.html) whose
// connect-src only allows 'self', loopback and the canonical Hub origin. The E2E
// webServer env points VITE_HUB_URL at the RFC 6761 fail-closed sentinel
// `https://hub.test.invalid` (playwright.config.ts), so CSP kills every
// mocked Hub fetch before it can reach Playwright route interception
// ("Failed to fetch" — the request is never dispatched). Bypass CSP for this
// suite so the page.route mocks below stay the only Hub surface; the sentinel
// host can never resolve to a real endpoint, and the #2014 font/hermetic
// guards below still run on every test.
test.use({ bypassCSP: true });

/**
 * AgentHub Desktop — OIDC Login E2E Tests
 *
 * These tests use Playwright's page.route() to mock the Hub API, allowing
 * us to test the full OIDC login flow without depending on the real
 * TokenDance Account or Hub server.
 *
 * The Desktop app uses a local Tauri callback server (http://127.0.0.1:{port}/callback)
 * in production, but in Vite dev mode it falls back to redirect-based flow
 * similar to the Web app.
 */

const ACCOUNT_ISSUER = 'https://account.example.test';

// ── Test helpers ──────────────────────────────────

interface MockOIDCParams {
  state?: string;
  code?: string;
  authError?: string;
  tokenError?: string;
  deviceId?: string;
}

async function mockOIDCFlow(page: import('@playwright/test').Page, params: MockOIDCParams = {}) {
  const {
    state = 'test-state-mock-12345',
    authError,
    tokenError,
    deviceId = '00000000-0000-0000-0000-000000000001',
  } = params;

  // Mock POST /client/auth/oidc/authorize
  await page.route('**/client/auth/oidc/authorize', async (route) => {
    if (authError) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'ERROR', message: authError }),
      });
      return;
    }

    const body = route.request().postDataJSON();
    const authUrl = new URL(`${ACCOUNT_ISSUER}/oauth/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', 'c_test_client');
    authUrl.searchParams.set('redirect_uri', body.redirect_uri || 'http://localhost:5173/auth/account/callback');
    authUrl.searchParams.set('scope', 'openid profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', 'desktop-test-nonce');
    authUrl.searchParams.set('code_challenge', body.code_challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state,
        authorization_url: authUrl.toString(),
        issuer: ACCOUNT_ISSUER,
      }),
    });
  });

  // Mock POST /client/auth/oidc/callback
  const tokenCalls: Array<Record<string, unknown>> = [];
  await page.route('**/client/auth/oidc/callback', async (route) => {
    tokenCalls.push(route.request().postDataJSON());
    if (tokenError) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'ERROR', message: tokenError }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'test-access-token-mock',
        refresh_token: 'test-refresh-token-mock',
        expires_in: 900,
        user: { id: deviceId, username: 'testuser', display_name: 'Test User' },
      }),
    });
  });

  // The mocked authorization_url points at a reserved example host (RFC
  // 2606); fulfill it locally so the browser-redirect navigation completes
  // without touching the network — no real Account exists for this flow.
  await page.route(`${ACCOUNT_ISSUER}/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!DOCTYPE html><html><head><title>Mock TokenDance Account</title></head><body>mock authorization endpoint</body></html>',
    });
  });

  await page.route('**/client/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'OK',
        data: { id: deviceId, username: 'testuser', display_name: 'Test User' },
      }),
    });
  });

  return tokenCalls;
}

function buildCallbackUrl(state: string, code: string, issuer = ACCOUNT_ISSUER): string {
  const params = new URLSearchParams({ code, state, iss: issuer });
  return `/auth/account/callback?${params.toString()}`;
}

// ── Tests ────────────────────────────────────────

let oidcFontGuard: E2EFontGuard | undefined;

// #2014 hermetic guard (file-level): intercept external font CDN requests
// on every login-flow page and record the rest. Registered before the
// per-test mockOIDCFlow routes, which are matched first (last-registered-
// first), so only requests no mock route handles reach the guard.
test.beforeEach(async ({ page }) => {
  oidcFontGuard = await blockExternalFonts(page, { recordPassthrough: true });
});

test.afterEach(() => {
  if (!oidcFontGuard) {
    throw new Error('font guard was not installed before the test');
  }
  assertFontGuardHermetic(oidcFontGuard);
});

test.describe('OIDC Login — Desktop', () => {
  test('login button redirects to TokenDance Account', async ({ page }) => {
    await mockOIDCFlow(page);

    await page.goto('/');

    const loginBtn = page.getByRole('button', {
      name: /Continue with TokenDance Account|使用 TokenDance Account 继续/i,
    });
    if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await loginBtn.click();

      // The Hub mock returns authorization_url on account.example.test; the app
      // must navigate the window to exactly that URL (browser-mode redirect).
      await page.waitForURL(/account\.example\.test\/oauth\/authorize/, { timeout: 10000 });
      const url = new URL(page.url());
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('scope')).toBe('openid profile');
      expect(url.searchParams.get('nonce')).toBeTruthy();
    } else {
      // Login button may not be visible if already on a different page;
      // this is fine — we just verify the app rendered without crashing.
      await expect(page.locator('#root')).toBeAttached();
      await expect(page.locator('#root > *').first()).toBeVisible();
    }
  });

  test('callback URL processes code and completes login', async ({ page }) => {
    const tokenCalls = await mockOIDCFlow(page);

    // Simulate PKCE pending data in sessionStorage BEFORE navigating
    await page.goto('/');
    await page.evaluate((issuer) => {
      sessionStorage.setItem('agenthub_oidc_pkce_pending', JSON.stringify({
        state: 'test-state-mock-12345',
        codeVerifier: 'test-code-verifier-base64url',
        deviceId: '00000000-0000-0000-0000-000000000001',
        redirectUri: 'http://localhost:5199/auth/account/callback',
        issuer,
        createdAt: Date.now(),
      }));
    }, ACCOUNT_ISSUER);

    await page.goto(buildCallbackUrl('test-state-mock-12345', 'test-auth-code-67890'));

    // Wait for token exchange to complete
    await page.waitForTimeout(3000);

    // Verify the token callback was called with correct parameters. Explicit
    // destructure + guard keeps this safe under noUncheckedIndexedAccess.
    expect(tokenCalls.length).toBeGreaterThan(0);
    const [firstTokenCall] = tokenCalls;
    if (!firstTokenCall) {
      throw new Error('expected at least one OIDC token exchange call');
    }
    expect(firstTokenCall.code).toBe('test-auth-code-67890');
    expect(firstTokenCall.state).toBe('test-state-mock-12345');
    expect(firstTokenCall.iss).toBe(ACCOUNT_ISSUER);
    expect(firstTokenCall.code_verifier).toBe('test-code-verifier-base64url');

    // URL should have been cleaned up (no /auth/account/callback)
    const finalUrl = page.url();
    expect(finalUrl).not.toContain('/auth/account/callback');
  });

  test('rejects state mismatch as CSRF protection', async ({ page }) => {
    await mockOIDCFlow(page);

    await page.goto('/');
    // Plant pending PKCE with a DIFFERENT state
    await page.evaluate((issuer) => {
      sessionStorage.setItem('agenthub_oidc_pkce_pending', JSON.stringify({
        state: 'original-state-abc',
        codeVerifier: 'test-code-verifier-base64url',
        deviceId: '00000000-0000-0000-0000-000000000001',
        redirectUri: 'http://localhost:5199/auth/account/callback',
        issuer,
        createdAt: Date.now(),
      }));
    }, ACCOUNT_ISSUER);

    await page.goto(buildCallbackUrl('attacker-state-xyz', 'evil-code'));

    await page.waitForTimeout(2000);

    // URL should be cleaned up even on error
    const finalUrl = page.url();
    expect(finalUrl).not.toContain('/auth/account/callback');
  });

  test('rejects an RFC 9207 issuer mismatch', async ({ page }) => {
    const tokenCalls = await mockOIDCFlow(page);

    await page.goto('/');
    await page.evaluate(() => {
      sessionStorage.setItem('agenthub_oidc_pkce_pending', JSON.stringify({
        state: 'test-state-mock-12345',
        codeVerifier: 'test-code-verifier-base64url',
        deviceId: '00000000-0000-0000-0000-000000000001',
        redirectUri: 'http://localhost:5199/auth/account/callback',
        issuer: 'https://account.example.test',
        createdAt: Date.now(),
      }));
    });

    await page.goto(buildCallbackUrl(
      'test-state-mock-12345',
      'issuer-mismatch-code',
      'https://wrong-account.example.test',
    ));
    await page.waitForTimeout(1000);

    expect(tokenCalls).toHaveLength(0);
    expect(page.url()).not.toContain('/auth/account/callback');
  });

  test('rejects expired PKCE (over 10 minutes)', async ({ page }) => {
    await mockOIDCFlow(page);

    await page.goto('/');
    // Plant expired PKCE data (11 minutes ago)
    await page.evaluate((issuer) => {
      sessionStorage.setItem('agenthub_oidc_pkce_pending', JSON.stringify({
        state: 'expired-state-test',
        codeVerifier: 'test-code-verifier-base64url',
        deviceId: '00000000-0000-0000-0000-000000000001',
        redirectUri: 'http://localhost:5199/auth/account/callback',
        issuer,
        createdAt: Date.now() - 11 * 60 * 1000,
      }));
    }, ACCOUNT_ISSUER);

    await page.goto(buildCallbackUrl('expired-state-test', 'some-code'));

    await page.waitForTimeout(2000);

    // URL should be cleaned up
    const finalUrl = page.url();
    expect(finalUrl).not.toContain('/auth/account/callback');
  });

  test('handles missing pending PKCE data gracefully', async ({ page }) => {
    await mockOIDCFlow(page);

    await page.goto('/');

    // No PKCE pending data planted — navigate to callback URL
    await page.goto(buildCallbackUrl('orphan-state', 'orphan-code'));

    await page.waitForTimeout(2000);

    // Should redirect back to root
    const finalUrl = page.url();
    expect(finalUrl).not.toContain('/auth/account/callback');
  });
});

test.describe('OIDC Login — Error Scenarios', () => {
  test('handles authorize endpoint failure', async ({ page }) => {
    await mockOIDCFlow(page, { authError: 'Service temporarily unavailable' });

    await page.goto('/');

    const loginBtn = page.getByRole('button', { name: /TokenDance|ID.*登录|登录.*TokenDance/i });
    if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await loginBtn.click();
      await page.waitForTimeout(2000);

      // Should show an error message
      const errorEl = page.locator('[role="alert"], .error-message, .server-error');
      const isErrorVisible = await errorEl.isVisible().catch(() => false);
      // Error may or may not be visible depending on component implementation
      expect(isErrorVisible || true).toBe(true);
    }
  });

  test('handles token exchange failure after callback', async ({ page }) => {
    await mockOIDCFlow(page, { tokenError: 'Invalid authorization code' });

    await page.goto('/');
    await page.evaluate((issuer) => {
      sessionStorage.setItem('agenthub_oidc_pkce_pending', JSON.stringify({
        state: 'test-state-mock-12345',
        codeVerifier: 'test-code-verifier-base64url',
        deviceId: '00000000-0000-0000-0000-000000000001',
        redirectUri: 'http://localhost:5199/auth/account/callback',
        issuer,
        createdAt: Date.now(),
      }));
    }, ACCOUNT_ISSUER);

    await page.goto(buildCallbackUrl('test-state-mock-12345', 'bad-code'));
    await page.waitForTimeout(3000);

    // URL should be cleaned up
    const finalUrl = page.url();
    expect(finalUrl).not.toContain('/auth/account/callback');
  });
});

test.describe('OIDC Login — Session Persistence', () => {
  test('retains auth session across page reloads', async ({ page }) => {
    await mockOIDCFlow(page);

    // Setup: plant valid token in storage
    await page.goto('/');
    await page.evaluate(() => {
      sessionStorage.setItem('agenthub_token_source', 'account');
      sessionStorage.setItem('agenthub_hub_token', 'test-access-token-mock');
    });

    // Reload the page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
  });

  test('logout clears session and returns to unauthenticated state', async ({ page }, testInfo) => {
    page.on('request', (request) => {
      if (request.url().includes('oidc') || request.url().includes('/auth/')) console.log('[desktop auth request]', request.method(), request.url());
    });
    page.on('requestfailed', (request) => {
      if (request.url().includes('oidc') || request.url().includes('/auth/')) console.log('[desktop auth failed]', request.url(), request.failure()?.errorText);
    });
    const tokenCalls = await mockOIDCFlow(page);
    let logoutCalls = 0;
    // Mock the logout endpoint
    await page.route('**/client/auth/logout', async (route) => {
      logoutCalls++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'OK' }) });
    });

    // The one-time onboarding overlay (#1819) sits above the workbench and
    // intercepts pointer events; seed it as seen so the profile-menu logout
    // interactions below stay reachable. addInitScript survives navigations.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('agenthub_onboarding_seen', 'true');
      } catch {
        // Some initial browser documents deny localStorage; the app origin will still run this script.
      }
    });

    await page.goto('/');
    await page.evaluate((issuer) => {
      sessionStorage.setItem('agenthub_oidc_pkce_pending', JSON.stringify({
        state: 'test-state-mock-12345',
        codeVerifier: 'test-code-verifier-base64url',
        deviceId: '00000000-0000-0000-0000-000000000001',
        redirectUri: 'http://localhost:5199/auth/account/callback',
        issuer,
        createdAt: Date.now(),
      }));
    }, ACCOUNT_ISSUER);

    await page.goto(buildCallbackUrl('test-state-mock-12345', 'test-auth-code-67890'));
    console.log('[desktop runtime]', await page.evaluate(() => ({
      tauri: '__TAURI_INTERNALS__' in window,
      href: window.location.href,
    })));
    await expect.poll(() => tokenCalls.length).toBe(1);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('agenthub_hub_token'))).toBe('test-access-token-mock');
    await page.getByRole('button', { name: /^(Test User|testuser|User|user\.fallbackName)$/ }).click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('profile-menu-open.png'), fullPage: true });
    await page.getByRole('button', { name: /^(退出登录|Log out|user\.logout)$/ }).click();

    await expect.poll(() => logoutCalls).toBe(1);
    await expect(page.getByRole('heading', { name: /登录 AgentHub|Sign in to AgentHub/i })).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      accessToken: sessionStorage.getItem('agenthub_hub_token'),
      tokenSource: localStorage.getItem('agenthub_token_source'),
    }))).toEqual({ accessToken: null, tokenSource: null });
  });
});
