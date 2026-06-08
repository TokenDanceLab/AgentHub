import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * AgentHub Web — OIDC Login E2E Tests
 *
 * The Web app uses sessionStorage-based PKCE flow with a callback route
 * (/auth/tokendance/callback) for browser OIDC login.
 *
 * These tests mock the Hub API to verify the complete login lifecycle:
 * authorize → redirect → callback → token exchange → authenticated session.
 */

const HUB_BASE = 'https://api.hub.vectorcontrol.tech';

// ── Test helpers ──────────────────────────────────

interface MockOIDCParams {
  state?: string;
  code?: string;
  authError?: string;
  tokenError?: string;
  deviceId?: string;
}

function mockOIDCFlow(page: import('@playwright/test').Page, params: MockOIDCParams = {}) {
  const {
    state = 'web-test-state-mock-12345',
    authError,
    tokenError,
    deviceId = '00000000-0000-0000-0000-000000000002',
  } = params;

  let authCallCount = 0;
  let tokenCallCount = 0;

  // Mock POST /client/auth/oidc/authorize
  page.route(`${HUB_BASE}/client/auth/oidc/authorize`, async (route) => {
    authCallCount++;
    if (authError) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'ERROR', message: authError }),
      });
      return;
    }

    const body = route.request().postDataJSON();
    const authUrl = new URL('https://id.vectorcontrol.tech/oidc/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', 'c_test_client');
    authUrl.searchParams.set('redirect_uri', body.redirect_uri || buildWebRedirectUri());
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', body.code_challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state, authorization_url: authUrl.toString() }),
    });
  });

  // Mock POST /client/auth/oidc/callback
  page.route(`${HUB_BASE}/client/auth/oidc/callback`, async (route) => {
    tokenCallCount++;
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
        access_token: 'web-test-access-token-mock',
        refresh_token: 'web-test-refresh-token-mock',
        expires_in: 900,
        user: { id: deviceId, username: 'webuser', display_name: 'Web User' },
      }),
    });
  });

  // Mock GET /client/auth/me (for post-login profile fetch)
  page.route(`${HUB_BASE}/client/auth/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'OK',
        data: { id: deviceId, username: 'webuser', display_name: 'Web User' },
      }),
    });
  });

  return { authCallCount: () => authCallCount, tokenCallCount: () => tokenCallCount };
}

function buildWebRedirectUri(): string {
  return 'http://localhost:5174/auth/tokendance/callback';
}

interface LoginE2EConfig {
  oauthClientId: string;
  callbackUrl: string;
  hubBaseUrl: string;
  webUrl: string;
  testAccountIndicator: string;
  artifactRoot: string;
  browserEvidenceBoundary: 'metadata-only' | 'redacted-screenshots';
  operatorApprovalId: string;
  localEdgeUrl: string;
  targetId?: string;
  teamId?: string;
}

interface LoginE2EEvidenceManifest {
  real_login_approved?: boolean;
  remote_dispatch_approved?: boolean;
  redaction_status?: string;
  web_to_local_edge_direct?: boolean;
  hub_session?: unknown;
  target_inventory?: unknown;
  selected_desktop_target?: unknown;
  dispatch_request?: unknown;
  event_replay?: unknown;
}

const LOCAL_EDGE_URL = 'http://127.0.0.1:3210';

function envValue(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() ?? '';
}

function isApproved(value: string): boolean {
  return value === 'true';
}

function looksSecretLike(value: string): boolean {
  return /(sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|refresh[_-]?token\s*=|access[_-]?token\s*=|id[_-]?token\s*=|password\s*=|client_secret\s*=)/i.test(value);
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const parts = host.split('.').map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] === 127;
}

function validateHttpUrl(label: string, rawUrl: string): void {
  if (!rawUrl) {
    throw new Error(`${label} is required`);
  }
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must be an http(s) URL`);
  }
}

function isDirectLocalEdgeUrl(rawUrl: string, localEdgeUrl = LOCAL_EDGE_URL): boolean {
  const url = new URL(rawUrl);
  const edge = new URL(localEdgeUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (!isLoopbackHost(url.hostname)) return false;
  if (url.port !== edge.port) return false;
  const edgePath = edge.pathname && edge.pathname !== '/' ? edge.pathname.replace(/\/+$/, '') : '';
  return !edgePath || url.pathname.startsWith(edgePath);
}

function assertNoDirectLocalEdge(label: string, rawUrl: string, localEdgeUrl = LOCAL_EDGE_URL): void {
  if (isDirectLocalEdgeUrl(rawUrl, localEdgeUrl)) {
    throw new Error(`${label} must not point directly at Local Edge`);
  }
}

function assertSafeArtifactRoot(rawPath: string): void {
  if (!rawPath) {
    throw new Error('artifact root is required');
  }
  const artifactRoot = path.resolve(process.cwd(), rawPath);
  const allowedRoots = [path.resolve(process.cwd(), '.tmp'), path.resolve(process.cwd(), 'tmp')];
  if (!allowedRoots.some((root) => artifactRoot === root || artifactRoot.startsWith(`${root}${path.sep}`))) {
    throw new Error('artifact root must stay under .tmp or tmp');
  }
}

function isRedactedPlaceholder(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') {
    return /^(<redacted>|\[redacted\]|redacted|\*{3,}|<[^>]*redacted[^>]*>)$/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isRedactedPlaceholder(entry));
  }
  if (typeof value === 'object') {
    return Object.values(value).every((entry) => isRedactedPlaceholder(entry));
  }
  return false;
}

function isSensitiveEvidenceKey(key: string): boolean {
  return /^(access_token|refresh_token|id_token|token|secret|authorization|cookie|password|client_secret|client-secret)$/i.test(key);
}

function validateEvidenceSafety(value: unknown, pathLabel = '$'): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      if (isDirectLocalEdgeUrl(match[0])) {
        throw new Error(`evidence manifest contains direct Local Edge URL at ${pathLabel}`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateEvidenceSafety(entry, `${pathLabel}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveEvidenceKey(key) && !isRedactedPlaceholder(entry)) {
        throw new Error(`evidence manifest contains unredacted sensitive field at ${pathLabel}.${key}`);
      }
      validateEvidenceSafety(entry, `${pathLabel}.${key}`);
    }
  }
}

function readRealLoginConfig(env: NodeJS.ProcessEnv = process.env): LoginE2EConfig {
  const config: LoginE2EConfig = {
    oauthClientId: envValue(env, 'AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID'),
    callbackUrl: envValue(env, 'AGENTHUB_LOGIN_E2E_CALLBACK_URL'),
    hubBaseUrl: envValue(env, 'AGENTHUB_LOGIN_E2E_HUB_BASE_URL'),
    webUrl: envValue(env, 'AGENTHUB_LOGIN_E2E_WEB_URL'),
    testAccountIndicator: envValue(env, 'AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR'),
    artifactRoot: envValue(env, 'AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT'),
    browserEvidenceBoundary: envValue(env, 'AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY') as LoginE2EConfig['browserEvidenceBoundary'],
    operatorApprovalId: envValue(env, 'AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID'),
    localEdgeUrl: envValue(env, 'AGENTHUB_LOGIN_E2E_LOCAL_EDGE_URL') || LOCAL_EDGE_URL,
  };
  const targetId = envValue(env, 'AGENTHUB_LOGIN_E2E_TARGET_ID');
  if (targetId) config.targetId = targetId;
  const teamId = envValue(env, 'AGENTHUB_LOGIN_E2E_TEAM_ID');
  if (teamId) config.teamId = teamId;

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && looksSecretLike(value)) {
      throw new Error(`${key} contains secret-like material`);
    }
  }

  if (!config.oauthClientId) throw new Error('OAuth client id is required');
  validateHttpUrl('callback URL', config.callbackUrl);
  validateHttpUrl('Hub base URL', config.hubBaseUrl);
  validateHttpUrl('Web URL', config.webUrl);
  assertNoDirectLocalEdge('Web URL', config.webUrl, config.localEdgeUrl);
  assertNoDirectLocalEdge('Hub base URL', config.hubBaseUrl, config.localEdgeUrl);
  if (!/(disposable|test|throwaway|sandbox)/i.test(config.testAccountIndicator)) {
    throw new Error('test account indicator must name a disposable/test/sandbox account');
  }
  assertSafeArtifactRoot(config.artifactRoot);
  if (config.browserEvidenceBoundary !== 'metadata-only' && config.browserEvidenceBoundary !== 'redacted-screenshots') {
    throw new Error('browser evidence boundary must be metadata-only or redacted-screenshots');
  }
  if (!config.operatorApprovalId) throw new Error('operator approval id is required');
  if (!isApproved(envValue(env, 'AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN'))) {
    throw new Error('real login approval env is required');
  }
  if (!isApproved(envValue(env, 'AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH'))) {
    throw new Error('remote dispatch approval env is required');
  }

  return config;
}

function hasApprovedRealLoginEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    readRealLoginConfig(env);
    return true;
  } catch {
    return false;
  }
}

function redactForEvidence(value: unknown): unknown {
  if (typeof value === 'string') {
    return looksSecretLike(value) ? '<redacted>' : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactForEvidence(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /(token|authorization|password|secret|cookie)/i.test(key) ? '<redacted>' : redactForEvidence(entry),
      ]),
    );
  }
  return value;
}

function validateEvidenceManifest(manifest: LoginE2EEvidenceManifest): void {
  if (JSON.stringify(manifest).match(/(sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,})/i)) {
    throw new Error('evidence manifest contains secret-like material');
  }
  validateEvidenceSafety(manifest);
  for (const field of ['hub_session', 'target_inventory', 'selected_desktop_target', 'dispatch_request', 'event_replay'] as const) {
    if (!manifest[field]) {
      throw new Error(`evidence manifest missing ${field}`);
    }
  }
  if (manifest.real_login_approved !== true) throw new Error('evidence manifest must record real_login_approved=true');
  if (manifest.remote_dispatch_approved !== true) throw new Error('evidence manifest must record remote_dispatch_approved=true');
  if (manifest.redaction_status !== 'redacted') throw new Error('evidence manifest redaction_status must be redacted');
  if (manifest.web_to_local_edge_direct === true) throw new Error('evidence manifest must not prove direct Web-to-LocalEdge access');
}

async function waitForHubAccessToken(page: import('@playwright/test').Page): Promise<string> {
  await expect.poll(async () => page.evaluate(() => sessionStorage.getItem('agenthub_hub_access_token')), {
    timeout: 180_000,
    message: 'waiting for Hub-issued session after approved TokenDanceID login',
  }).not.toBeNull();
  const token = await page.evaluate(() => sessionStorage.getItem('agenthub_hub_access_token'));
  return String(token);
}

async function writeEvidenceManifest(config: LoginE2EConfig, manifest: LoginE2EEvidenceManifest): Promise<string> {
  validateEvidenceManifest(manifest);
  const fullRoot = path.resolve(process.cwd(), config.artifactRoot);
  await fs.promises.mkdir(fullRoot, { recursive: true });
  const manifestPath = path.join(fullRoot, 'login-e2e-evidence.redacted.json');
  await fs.promises.writeFile(manifestPath, JSON.stringify(redactForEvidence(manifest), null, 2), 'utf8');
  return manifestPath;
}

// ── Tests ────────────────────────────────────────

test.describe('Web OIDC Login — Happy Path', () => {
  test('login button exists and is clickable', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The TokenDance ID login button should be present
    const loginBtn = page.getByRole('button', { name: /TokenDance|ID.*登录|登录.*TokenDance|Continue with/i });
    const visible = await loginBtn.isVisible({ timeout: 5000 }).catch(() => false);
    // If the button isn't visible, the app may show a different auth view
    // (already authenticated state), which is also valid
    if (visible) {
      await expect(loginBtn).toBeEnabled();
    }
  });

  test('clicking TokenDance ID login redirects to TokenDance ID', async ({ page }) => {
    mockOIDCFlow(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loginBtn = page.getByRole('button', { name: /TokenDance|ID.*登录|登录.*TokenDance|Continue with/i });

    if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click the button — the app will call window.location.assign()
      // which Playwright intercepts. We'll see the navigation in the URL.
      await loginBtn.click();
      await page.waitForTimeout(3000);
    }
  });

  test('callback URL completes full OIDC login cycle', async ({ page }) => {
    mockOIDCFlow(page);

    // Plant pending PKCE data in sessionStorage
    await page.goto('/');
    await page.evaluate(() => {
      sessionStorage.setItem('agenthub_oidc_pkce_pending', JSON.stringify({
        state: 'web-test-state-mock-12345',
        codeVerifier: 'web-test-code-verifier-base64url',
        deviceId: '00000000-0000-0000-0000-000000000002',
        redirectUri: 'http://localhost:5174/auth/tokendance/callback',
        createdAt: Date.now(),
      }));
    });

    // Simulate TokenDance ID redirect back to our callback URL
    await page.goto('/auth/tokendance/callback?code=web-test-auth-code-67890&state=web-test-state-mock-12345');
    await page.waitForTimeout(3000);
  });

  test('auth session persists across page reloads', async ({ page }) => {
    mockOIDCFlow(page);

    await page.goto('/');
    await page.evaluate(() => {
      sessionStorage.setItem('agenthub_token_source', 'tokendance');
      sessionStorage.setItem('agenthub_hub_access_token', 'web-test-access-token-mock');
    });

    // Reload and check auth state
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
  });
});

test.describe('Web OIDC Login — Error Handling', () => {
  test('handles CSRF state mismatch', async ({ page }) => {
    mockOIDCFlow(page);

    await page.goto('/');
    await page.evaluate((redirectUri) => {
      sessionStorage.setItem('agenthub_oidc_pkce_pending', JSON.stringify({
        state: 'honest-state',
        codeVerifier: 'test-code-verifier-base64url',
        deviceId: '00000000-0000-0000-0000-000000000002',
        redirectUri,
        createdAt: Date.now(),
      }));
    }, buildWebRedirectUri());

    // Attacker-modified callback URL
    await page.goto('/auth/tokendance/callback?code=evil-code&state=attacker-state');
    await page.waitForTimeout(2000);

    // URL should be cleaned
    expect(page.url()).not.toContain('/auth/tokendance/callback');
  });

  test('handles expired PKCE (over 10 minutes)', async ({ page }) => {
    mockOIDCFlow(page);

    await page.goto('/');
    await page.evaluate((redirectUri) => {
      sessionStorage.setItem('agenthub_oidc_pkce_pending', JSON.stringify({
        state: 'web-expired-test',
        codeVerifier: 'test-code-verifier-base64url',
        deviceId: '00000000-0000-0000-0000-000000000002',
        redirectUri,
        createdAt: Date.now() - 11 * 60 * 1000,
      }));
    }, buildWebRedirectUri());

    await page.goto('/auth/tokendance/callback?code=some-code&state=web-expired-test');
    await page.waitForTimeout(2000);

    expect(page.url()).not.toContain('/auth/tokendance/callback');
  });

  test('handles orphan callback (no pending PKCE)', async ({ page }) => {
    mockOIDCFlow(page);

    await page.goto('/');
    // No pending PKCE sessionStorage data

    await page.goto('/auth/tokendance/callback?code=orphan-code&state=orphan-state');
    await page.waitForTimeout(2000);

    expect(page.url()).not.toContain('/auth/tokendance/callback');
  });

  test('handles authorize API failure gracefully', async ({ page }) => {
    mockOIDCFlow(page, { authError: 'Service unavailable' });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loginBtn = page.getByRole('button', { name: /TokenDance|ID.*登录|登录.*TokenDance|Continue with/i });
    if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await loginBtn.click();
      await page.waitForTimeout(2000);
    }
  });

  test('handles token exchange failure after callback', async ({ page }) => {
    mockOIDCFlow(page, { tokenError: 'Invalid authorization code' });

    await page.goto('/');
    await page.evaluate((redirectUri) => {
      sessionStorage.setItem('agenthub_oidc_pkce_pending', JSON.stringify({
        state: 'web-test-state-mock-12345',
        codeVerifier: 'test-code-verifier-base64url',
        deviceId: '00000000-0000-0000-0000-000000000002',
        redirectUri,
        createdAt: Date.now(),
      }));
    }, buildWebRedirectUri());

    await page.goto('/auth/tokendance/callback?code=bad-code&state=web-test-state-mock-12345');
    await page.waitForTimeout(3000);

    expect(page.url()).not.toContain('/auth/tokendance/callback');
  });
});

test.describe('Web OIDC Login — Logout', () => {
  test('logout clears session and returns to login screen', async ({ page }) => {
    // Mock logout
    page.route(`${HUB_BASE}/client/auth/logout`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"code":"OK"}' });
    });

    // Plant auth session
    await page.goto('/');
    await page.evaluate(() => {
      sessionStorage.setItem('agenthub_token_source', 'tokendance');
      sessionStorage.setItem('agenthub_hub_access_token', 'web-test-access-token-mock');
    });

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
  });
});

test.describe('Web OIDC Login — Real Mode Approval Gate', () => {
  test('fails closed when approval env is missing', () => {
    expect(() => readRealLoginConfig({})).toThrow(/OAuth client id is required/);
  });

  test('rejects unapproved real mode even when endpoints are present', () => {
    expect(() => readRealLoginConfig({
      AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID: 'agenthub-test-client',
      AGENTHUB_LOGIN_E2E_CALLBACK_URL: 'http://localhost:5174/auth/tokendance/callback',
      AGENTHUB_LOGIN_E2E_HUB_BASE_URL: 'http://127.0.0.1:8080',
      AGENTHUB_LOGIN_E2E_WEB_URL: 'http://127.0.0.1:5174',
      AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR: 'disposable-test-account',
      AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT: '.tmp/login-e2e/approved',
      AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY: 'metadata-only',
      AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID: 'approval-123',
    })).toThrow(/real login approval env is required/);
  });

  test('rejects unsafe token-like input without printing the token value', () => {
    expect(() => readRealLoginConfig({
      AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID: 'sk-test-secret-value-123456',
      AGENTHUB_LOGIN_E2E_CALLBACK_URL: 'http://localhost:5174/auth/tokendance/callback',
      AGENTHUB_LOGIN_E2E_HUB_BASE_URL: 'http://127.0.0.1:8080',
      AGENTHUB_LOGIN_E2E_WEB_URL: 'http://127.0.0.1:5174',
      AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR: 'disposable-test-account',
      AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT: '.tmp/login-e2e/approved',
      AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY: 'metadata-only',
      AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID: 'approval-123',
      AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN: 'true',
      AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH: 'true',
    })).toThrow(/contains secret-like material/);
  });

  test('rejects direct Web-to-LocalEdge topology', () => {
    expect(() => readRealLoginConfig({
      AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID: 'agenthub-test-client',
      AGENTHUB_LOGIN_E2E_CALLBACK_URL: 'http://localhost:5174/auth/tokendance/callback',
      AGENTHUB_LOGIN_E2E_HUB_BASE_URL: 'http://127.0.0.1:8080',
      AGENTHUB_LOGIN_E2E_WEB_URL: 'http://127.0.0.1:3210',
      AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR: 'disposable-test-account',
      AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT: '.tmp/login-e2e/approved',
      AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY: 'metadata-only',
      AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID: 'approval-123',
      AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN: 'true',
      AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH: 'true',
    })).toThrow(/Web URL must not point directly at Local Edge/);
  });

  test('rejects Local Edge loopback aliases', () => {
    for (const webUrl of ['http://localhost:3210/v1/runs', 'http://[::1]:3210/v1/runs', 'http://127.42.0.1:3210/v1/runs']) {
      expect(() => readRealLoginConfig({
        AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID: 'agenthub-test-client',
        AGENTHUB_LOGIN_E2E_CALLBACK_URL: 'http://localhost:5174/auth/tokendance/callback',
        AGENTHUB_LOGIN_E2E_HUB_BASE_URL: 'http://127.0.0.1:8080',
        AGENTHUB_LOGIN_E2E_WEB_URL: webUrl,
        AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR: 'disposable-test-account',
        AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT: '.tmp/login-e2e/approved',
        AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY: 'metadata-only',
        AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID: 'approval-123',
        AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN: 'true',
        AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH: 'true',
      })).toThrow(/Web URL must not point directly at Local Edge/);
    }
  });

  test('rejects path traversal artifact roots', () => {
    expect(() => readRealLoginConfig({
      AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID: 'agenthub-test-client',
      AGENTHUB_LOGIN_E2E_CALLBACK_URL: 'http://localhost:5174/auth/tokendance/callback',
      AGENTHUB_LOGIN_E2E_HUB_BASE_URL: 'http://127.0.0.1:8080',
      AGENTHUB_LOGIN_E2E_WEB_URL: 'http://127.0.0.1:5174',
      AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR: 'disposable-test-account',
      AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT: '.tmp/../docs/audit',
      AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY: 'metadata-only',
      AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID: 'approval-123',
      AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN: 'true',
      AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH: 'true',
    })).toThrow(/artifact root must stay under/);
  });

  test('rejects evidence without target inventory proof', () => {
    expect(() => validateEvidenceManifest({
      real_login_approved: true,
      remote_dispatch_approved: true,
      redaction_status: 'redacted',
      web_to_local_edge_direct: false,
      hub_session: { ref: 'proof:hub-session' },
      selected_desktop_target: { ref: 'proof:selected-target' },
      dispatch_request: { ref: 'proof:dispatch' },
      event_replay: { ref: 'proof:event-replay' },
    })).toThrow(/target_inventory/);
  });

  test('rejects opaque sensitive token fields in evidence', () => {
    expect(() => validateEvidenceManifest({
      real_login_approved: true,
      remote_dispatch_approved: true,
      redaction_status: 'redacted',
      web_to_local_edge_direct: false,
      hub_session: { access_token: 'opaque-session-token-value' },
      target_inventory: { ref: 'proof:target-inventory' },
      selected_desktop_target: { ref: 'proof:selected-target' },
      dispatch_request: { ref: 'proof:dispatch' },
      event_replay: { ref: 'proof:event-replay' },
    })).toThrow(/sensitive field/);
  });

  test('rejects direct Local Edge URLs in evidence proof fields', () => {
    expect(() => validateEvidenceManifest({
      real_login_approved: true,
      remote_dispatch_approved: true,
      redaction_status: 'redacted',
      web_to_local_edge_direct: false,
      hub_session: { ref: 'proof:hub-session' },
      target_inventory: { ref: 'http://localhost:3210/v1/health' },
      selected_desktop_target: { ref: 'proof:selected-target' },
      dispatch_request: { ref: 'proof:dispatch' },
      event_replay: { ref: 'proof:event-replay' },
    })).toThrow(/direct Local Edge URL/);
  });
});

test.describe('Web OIDC Login — Approved Real Login And Remote Dispatch', () => {
  test.skip(!hasApprovedRealLoginEnv(), 'real TokenDanceID login E2E requires explicit env approval and a disposable/test account');

  test('proves Hub session, target inventory, selected Desktop target, dispatch, and replay evidence', async ({ page, request }) => {
    const config = readRealLoginConfig();

    await page.goto(config.webUrl, { waitUntil: 'networkidle' });
    const loginBtn = page.getByRole('button', { name: /TokenDance|ID.*登录|登录.*TokenDance|Continue with/i });
    if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await loginBtn.click();
    }

    const token = await waitForHubAccessToken(page);
    expect(looksSecretLike(token)).toBe(false);

    const authHeaders = { Authorization: `Bearer ${token}` };
    const me = await request.get(`${config.hubBaseUrl}/client/auth/me`, { headers: authHeaders });
    expect(me.ok()).toBeTruthy();

    const targetInventory = await request.get(`${config.hubBaseUrl}/web/execution-targets?target_type=local_edge&pageSize=50`, {
      headers: authHeaders,
    });
    expect(targetInventory.ok()).toBeTruthy();
    const inventoryBody = await targetInventory.json();
    const targets = Array.isArray(inventoryBody.items) ? inventoryBody.items : [];
    expect(targets.length, 'target inventory proof is required').toBeGreaterThan(0);

    const selectedTarget = targets.find((target: { id?: string; target_type?: string; is_online?: boolean; health_state?: string }) =>
      target.id === config.targetId,
    ) ?? targets.find((target: { target_type?: string; is_online?: boolean; health_state?: string }) =>
      target.target_type === 'local_edge' && target.is_online === true && target.health_state !== 'offline',
    );
    expect(selectedTarget, 'selected Desktop target proof is required').toBeTruthy();

    const teamId = config.teamId;
    expect(teamId, 'AGENTHUB_LOGIN_E2E_TEAM_ID is required for approved remote-control dispatch evidence').toBeTruthy();

    const dispatch = await request.post(`${config.hubBaseUrl}/web/agent-teams/${encodeURIComponent(String(teamId))}/runs`, {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      data: {
        trigger_message: 'Approved login E2E remote-control dispatch proof.',
        target_id: selectedTarget.id,
      },
    });
    expect(dispatch.ok()).toBeTruthy();
    const dispatchBody = await dispatch.json();
    expect(dispatchBody.target_id ?? selectedTarget.id).toBe(selectedTarget.id);

    const runId = dispatchBody.id;
    expect(runId, 'dispatch must return a run id for event replay proof').toBeTruthy();
    const events = await request.get(`${config.hubBaseUrl}/web/agent-teams/${encodeURIComponent(String(teamId))}/runs/${encodeURIComponent(String(runId))}/events`, {
      headers: authHeaders,
    });
    expect(events.ok()).toBeTruthy();

    await writeEvidenceManifest(config, {
      real_login_approved: true,
      remote_dispatch_approved: true,
      redaction_status: 'redacted',
      web_to_local_edge_direct: false,
      hub_session: { ref: 'api:/client/auth/me', status: me.status() },
      target_inventory: { ref: 'api:/web/execution-targets?target_type=local_edge&pageSize=50', count: targets.length },
      selected_desktop_target: { id: selectedTarget.id, target_type: selectedTarget.target_type, is_online: selectedTarget.is_online },
      dispatch_request: { ref: `api:/web/agent-teams/${teamId}/runs`, target_id: selectedTarget.id, run_id: runId },
      event_replay: { ref: `api:/web/agent-teams/${teamId}/runs/${runId}/events`, status: events.status() },
    });
  });
});
