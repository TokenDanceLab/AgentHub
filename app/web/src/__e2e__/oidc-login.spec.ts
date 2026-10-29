import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_FIXTURE_ORIGIN, browserSessionFixture, installBrowserSessionFixture, assertBrowserFixtureRequest } from './browserSessionFixture';

const ACCOUNT_ISSUER = 'https://account.example.test';
const WEB_CALLBACK_PATH = '/auth/account/callback';
const LOGIN_BUTTON = /Continue with TokenDance Account|使用 TokenDance Account 登录/;
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function callbackUrl(state = 'fixture-state', issuer = ACCOUNT_ISSUER) {
  return `${WEB_CALLBACK_PATH}?code=fixture-code&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(issuer)}`;
}

/** Fixture Account/Hub flow: server owns state/PKCE; no credential is extracted. */
async function mockBrowserFlow(page: Page, options: { authenticated?: boolean; authorizeFails?: boolean; callbackFails?: boolean } = {}) {
  await installBrowserSessionFixture(page);
  await page.addInitScript(() => { localStorage.setItem('agenthub.workbench.dataMode', 'approved-real'); });
  let authenticated = options.authenticated ?? false;
  let logoutFails = false;
  const calls: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === ACCOUNT_ISSUER) return route.fulfill({ contentType: 'text/html', body: '<h1>Fixture Account</h1>' });
    if (url.origin !== BROWSER_FIXTURE_ORIGIN) return route.abort();
    if (!/^\/(client|web)(\/|$)/.test(url.pathname)) return route.continue();
    calls.push(`${request.method()} ${url.pathname}`);
    assertBrowserFixtureRequest(request);
    const response = (data: unknown, status = 200) => route.fulfill({ status, json: { code: status === 200 ? 'ok' : 'auth_failed', data } });
    if (url.pathname === '/client/auth/browser/authorize') {
      expect(Object.keys(request.postDataJSON())).toEqual(['device_id']);
      return options.authorizeFails ? response(null, 503) : response({ state: 'fixture-state', issuer: ACCOUNT_ISSUER, authorization_url: `${ACCOUNT_ISSUER}/oauth/authorize?state=fixture-state` });
    }
    if (url.pathname === '/client/auth/browser/callback') {
      const body = request.postDataJSON();
      expect(Object.keys(body).sort()).toEqual(['code', 'iss', 'state']);
      if (options.callbackFails || body.state !== 'fixture-state' || body.iss !== ACCOUNT_ISSUER) return response(null, 400);
      authenticated = true;
      return response(browserSessionFixture({ id: 'web-user', username: 'webuser', nickname: 'Web User' }));
    }
    if (url.pathname === '/client/auth/browser/session') return authenticated
      ? response(browserSessionFixture({ id: 'web-user', username: 'webuser', nickname: 'Web User' }))
      : response(null, 401);
    if (url.pathname === '/client/auth/browser/logout' || url.pathname === '/client/auth/browser/logout/account') {
      if (logoutFails) return response(null, 503);
      authenticated = false;
      return response(url.pathname.endsWith('/account') ? { logout_url: `${ACCOUNT_ISSUER}/logout` } : null);
    }
    if (url.pathname === '/client/settings') return response({});
    return response(url.pathname.startsWith('/web/') || /public/.test(url.pathname) ? { items: [], page: { hasMore: false } } : []);
  });
  return { calls, setLogoutFails(value: boolean) { logoutFails = value; } };
}

test.describe('Web browser session fixture lifecycle', () => {
  test('anonymous bootstrap shows Account login and authorize redirects without client PKCE', async ({ page }) => {
    const flow = await mockBrowserFlow(page);
    await page.goto('/');
    await page.getByRole('button', { name: LOGIN_BUTTON }).click();
    await expect(page).toHaveURL(new RegExp('account\\.example\\.test/oauth/authorize'));
    expect(flow.calls).toContain('POST /client/auth/browser/authorize');
  });

  test('callback and reload restore the server profile without native bearer endpoints', async ({ page }) => {
    const flow = await mockBrowserFlow(page);
    await page.goto(callbackUrl());
    await expect(page.getByRole('button', { name: 'Web User', exact: true })).toBeVisible();
    await expect(page).toHaveURL(BROWSER_FIXTURE_ORIGIN + '/');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Web User', exact: true })).toBeVisible();
    expect(flow.calls).toContain('POST /client/auth/browser/callback');
    expect(flow.calls).not.toContain('POST /client/auth/refresh');
    expect(flow.calls).not.toContain('GET /client/auth/me');
  });

  for (const [name, destination] of [
    ['mismatched state', callbackUrl('wrong-state')],
    ['mismatched issuer', callbackUrl('fixture-state', 'https://wrong.example.test')],
    ['incomplete callback', WEB_CALLBACK_PATH + '?error=access_denied'],
  ] as const) {
    test(`rejects ${name} and scrubs the callback URL`, async ({ page }) => {
      await mockBrowserFlow(page);
      await page.goto(destination);
      await expect(page.getByRole('button', { name: LOGIN_BUTTON })).toBeVisible();
      await expect(page).toHaveURL(BROWSER_FIXTURE_ORIGIN + '/');
      await expect(page.getByRole('button', { name: 'Web User', exact: true })).toHaveCount(0);
    });
  }

  test('authorize errors keep the login action retryable', async ({ page }) => {
    await mockBrowserFlow(page, { authorizeFails: true });
    await page.goto('/');
    await page.getByRole('button', { name: LOGIN_BUTTON }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByRole('button', { name: LOGIN_BUTTON })).toBeEnabled();
  });

  test('local logout preserves retry after failure and returns to login on success', async ({ page }) => {
    const flow = await mockBrowserFlow(page, { authenticated: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Web User', exact: true }).click();
    await page.getByRole('button', { name: /^(Log out|退出登录)$/ }).click();
    flow.setLogoutFails(true);
    await page.getByRole('button', { name: 'Log out of AgentHub', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not end the session');
    flow.setLogoutFails(false);
    await page.getByRole('button', { name: 'Log out of AgentHub', exact: true }).click();
    await expect(page.getByRole('button', { name: LOGIN_BUTTON })).toBeVisible();
  });

  test('Account logout follows the server-provided Account destination', async ({ page }) => {
    await mockBrowserFlow(page, { authenticated: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Web User', exact: true }).click();
    await page.getByRole('button', { name: /^(Log out|退出登录)$/ }).click();
    await page.getByRole('button', { name: 'Log out of AgentHub and Account', exact: true }).click();
    await expect(page).toHaveURL(ACCOUNT_ISSUER + '/logout');
  });
});

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

const LOCAL_EDGE_PORT = '3210';
const LOCAL_EDGE_LOOPBACK_HOST = ['127', '0', '0', '1'].join('.');
const LOCAL_EDGE_URL = `http://${LOCAL_EDGE_LOOPBACK_HOST}:${LOCAL_EDGE_PORT}`;
const EDGE_RUN_API_PATH = ['', 'v1', 'runs'].join('/');

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

function isSensitiveEvidenceKey(key: string, parentPath = ''): boolean {
  if (parentPath === '$' && key.toLowerCase() === 'hub_session') return false;
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['token', 'secret', 'password', 'cookie', 'authorization', 'session'].some((term) => normalized.includes(term));
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
      if (isSensitiveEvidenceKey(key, pathLabel) && !isRedactedPlaceholder(entry)) {
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
  validateEvidenceSafety(manifest);
  if (JSON.stringify(manifest).match(/(sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,})/i)) {
    throw new Error('evidence manifest contains secret-like material');
  }
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

async function writeEvidenceManifest(config: LoginE2EConfig, manifest: LoginE2EEvidenceManifest): Promise<string> {
  validateEvidenceManifest(manifest);
  const fullRoot = path.resolve(process.cwd(), config.artifactRoot);
  await fs.promises.mkdir(fullRoot, { recursive: true });
  const manifestPath = path.join(fullRoot, 'login-e2e-evidence.redacted.json');
  await fs.promises.writeFile(manifestPath, JSON.stringify(redactForEvidence(manifest), null, 2), 'utf8');
  return manifestPath;
}

test.describe('Web OIDC Login — Real Mode Approval Gate', () => {
  test('fails closed when approval env is missing', () => {
    expect(() => readRealLoginConfig({})).toThrow(/OAuth client id is required/);
  });

  test('rejects unapproved real mode even when endpoints are present', () => {
    expect(() => readRealLoginConfig({
      AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID: 'agenthub-test-client',
      AGENTHUB_LOGIN_E2E_CALLBACK_URL: 'http://localhost:5174/auth/account/callback',
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
      AGENTHUB_LOGIN_E2E_CALLBACK_URL: 'http://localhost:5174/auth/account/callback',
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
      AGENTHUB_LOGIN_E2E_CALLBACK_URL: 'http://localhost:5174/auth/account/callback',
      AGENTHUB_LOGIN_E2E_HUB_BASE_URL: 'http://127.0.0.1:8080',
      AGENTHUB_LOGIN_E2E_WEB_URL: LOCAL_EDGE_URL,
      AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR: 'disposable-test-account',
      AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT: '.tmp/login-e2e/approved',
      AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY: 'metadata-only',
      AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID: 'approval-123',
      AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN: 'true',
      AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH: 'true',
    })).toThrow(/Web URL must not point directly at Local Edge/);
  });

  test('rejects Local Edge loopback aliases', () => {
    const loopbackCases = [
      `http://localhost:${LOCAL_EDGE_PORT}${EDGE_RUN_API_PATH}`,
      `http://[::1]:${LOCAL_EDGE_PORT}${EDGE_RUN_API_PATH}`,
      `http://127.42.0.1:${LOCAL_EDGE_PORT}${EDGE_RUN_API_PATH}`,
    ];
    for (const webUrl of loopbackCases) {
      expect(() => readRealLoginConfig({
        AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID: 'agenthub-test-client',
        AGENTHUB_LOGIN_E2E_CALLBACK_URL: 'http://localhost:5174/auth/account/callback',
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
    for (const artifactRoot of ['.tmp/../outside/artifacts', '.tmpx/login-e2e', 'tmp-old/login-e2e', path.resolve(process.cwd(), '.tmp-sibling/login-e2e')]) {
      expect(() => readRealLoginConfig({
        AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID: 'agenthub-test-client',
        AGENTHUB_LOGIN_E2E_CALLBACK_URL: 'http://localhost:5174/auth/account/callback',
        AGENTHUB_LOGIN_E2E_HUB_BASE_URL: 'http://127.0.0.1:8080',
        AGENTHUB_LOGIN_E2E_WEB_URL: 'http://127.0.0.1:5174',
        AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR: 'disposable-test-account',
        AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT: artifactRoot,
        AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY: 'metadata-only',
        AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID: 'approval-123',
        AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN: 'true',
        AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH: 'true',
      })).toThrow(/artifact root must stay under/);
    }
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
    const sensitiveEvidenceCases: Array<[string, string]> = [
      ['access_token', 'opaque-session-token-value'],
      ['accessToken', 'opaque-session-token-value'],
      ['refreshToken', 'opaque-session-token-value'],
      ['idToken', 'opaque-session-token-value'],
      ['clientSecret', 'opaque-client-secret'],
      ['authorizationHeader', 'Bearer opaque-header-value'],
      ['session_token', 'opaque-session-token-value'],
      ['auth-cookie', 'opaque-cookie-value'],
    ];
    for (const [key, value] of sensitiveEvidenceCases) {
      expect(() => validateEvidenceManifest({
        real_login_approved: true,
        remote_dispatch_approved: true,
        redaction_status: 'redacted',
        web_to_local_edge_direct: false,
        hub_session: { [key]: value },
        target_inventory: { ref: 'proof:target-inventory' },
        selected_desktop_target: { ref: 'proof:selected-target' },
        dispatch_request: { ref: 'proof:dispatch' },
        event_replay: { ref: 'proof:event-replay' },
      })).toThrow(/sensitive field/);
    }
  });

  test('rejects direct Local Edge URLs in evidence proof fields', () => {
    expect(() => validateEvidenceManifest({
      real_login_approved: true,
      remote_dispatch_approved: true,
      redaction_status: 'redacted',
      web_to_local_edge_direct: false,
      hub_session: { ref: 'proof:hub-session' },
      target_inventory: { ref: `http://localhost:${LOCAL_EDGE_PORT}/v1/health` },
      selected_desktop_target: { ref: 'proof:selected-target' },
      dispatch_request: { ref: 'proof:dispatch' },
      event_replay: { ref: 'proof:event-replay' },
    })).toThrow(/direct Local Edge URL/);
  });
});

/** Runs only with the existing explicit operator/test-account gates. */
async function browserApi(page: Page, endpoint: string, data?: Record<string, unknown>) {
  return page.evaluate(async ({ endpoint, data }) => {
    const sessionResponse = await fetch('/client/auth/browser/session', { credentials: 'same-origin' });
    if (!sessionResponse.ok) return { status: sessionResponse.status, data: null };
    const session = (await sessionResponse.json()).data;
    if (endpoint === '/client/auth/browser/session') return { status: sessionResponse.status, data: { user: session.user } };
    const response = await fetch(endpoint, {
      credentials: 'same-origin', method: data ? 'POST' : 'GET',
      headers: data ? { 'Content-Type': 'application/json', 'X-Hub-CSRF': session.csrf_token } : {},
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const payload = await response.json();
    return { status: response.status, data: payload.data ?? payload };
  }, { endpoint, data });
}

test.describe('Web OIDC Login — Approved Real Login And Remote Dispatch', () => {
  test.skip(!hasApprovedRealLoginEnv(), 'Real Account lane requires explicit operator approval and disposable test identity; fixture success is not L3 evidence.');

  test('proves cookie session, explicit target dispatch and replay without extracting credentials', async ({ page }) => {
    const config = readRealLoginConfig();
    expect(new URL(config.hubBaseUrl).origin, 'browser Hub must share the application origin').toBe(new URL(config.webUrl).origin);
    await page.goto(config.webUrl);
    await expect.poll(async () => (await browserApi(page, '/client/auth/browser/session')).status, { timeout: 180_000 }).toBe(200);
    const me = await browserApi(page, '/client/auth/browser/session');
    const inventory = await browserApi(page, '/web/execution-targets?target_type=local_edge&pageSize=50');
    expect(inventory.status).toBe(200);
    const targets = inventory.data.items ?? [];
    expect(config.targetId, 'real dispatch requires an explicit target id').toBeTruthy();
    const selectedTarget = targets.find((target: { id: string }) => target.id === config.targetId);
    expect(selectedTarget?.is_online).toBe(true);
    expect(config.teamId, 'real dispatch requires an explicit team id').toBeTruthy();
    const dispatchPath = `/web/agent-teams/${encodeURIComponent(config.teamId ?? '')}/runs`;
    const dispatch = await browserApi(page, dispatchPath, { trigger_message: 'Approved login E2E dispatch proof.', target_id: selectedTarget.id });
    expect(dispatch.status).toBeLessThan(300);
    const runId = dispatch.data.id;
    expect(runId).toBeTruthy();
    const eventsPath = `${dispatchPath}/${encodeURIComponent(runId)}/events`;
    const events = await browserApi(page, eventsPath);
    expect(events.status).toBe(200);
    await writeEvidenceManifest(config, {
      real_login_approved: true, remote_dispatch_approved: true, redaction_status: 'redacted', web_to_local_edge_direct: false,
      hub_session: { ref: 'api:/client/auth/browser/session', status: me.status },
      target_inventory: { ref: 'api:/web/execution-targets', count: targets.length },
      selected_desktop_target: { id: selectedTarget.id, target_type: selectedTarget.target_type },
      dispatch_request: { ref: `api:${dispatchPath}`, target_id: selectedTarget.id, run_id: runId },
      event_replay: { ref: `api:${eventsPath}`, status: events.status },
    });
  });
});
