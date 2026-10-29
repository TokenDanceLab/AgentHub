import { browserHubJson } from './browserCookieSession';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AgentHub real OIDC browser E2E — 真浏览器 × 真本地栈。
 *
 * 与 chat-real.spec.ts（dev-secret 自签 JWT 旁路 + API 级断言）互补：
 * 本 spec 走真实的 TokenDance Account OIDC Authorization Code + PKCE 浏览器
 * 登录动线（禁用任何自签 JWT/旁路），并断言聊天消息真实落 hub。
 *
 * 前置（operator Account + hub :8080 / edge :3210 / web :5174）：
 *   bash scripts/e2e/provision-real-e2e-stack.sh
 *   （供给测试账号并落凭据到 tests/artifacts/real-e2e-account.env，gitignored）
 *
 * 运行：
 *   cd app/web && pnpm exec playwright test --config playwright.real.config.ts \
 *     --project=chromium real-oidc-login.spec.ts
 *
 * 证据等级：approved-real（真实外部 Account issuer；real_tested=true）。
 * CI 状态：非 PR 检查；由 dispatch-only 的 real-e2e-stack lane
 * （checks.yml → scripts/e2e/run-real-e2e-lane.sh）运行。
 */

interface RealE2ECredentials {
  accountIssuer: string;
  hubBaseUrl: string;
  webBaseUrl: string;
  userEmail: string;
  userPassword: string;
  partnerEmail: string;
  partnerPassword: string;
}

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SPEC_DIR, '..', '..');
const ACCOUNT_ENV_PATH = path.join(REPO_ROOT, 'tests', 'artifacts', 'real-e2e-account.env');
const WORKBENCH_PATH = '/workbench/';
const CALLBACK_PATH = '/workbench/auth/account/callback';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function envValue(key: string): string {
  return process.env[key]?.trim() ?? '';
}

function readAccountEnvFile(): Record<string, string> {
  if (!fs.existsSync(ACCOUNT_ENV_PATH)) return {};
  const parsed: Record<string, string> = {};
  for (const line of fs.readFileSync(ACCOUNT_ENV_PATH, 'utf8').split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0) parsed[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return parsed;
}

/** 凭据优先级：环境变量 > tests/artifacts/real-e2e-account.env（供给脚本产物）。 */
function loadCredentials(): RealE2ECredentials | null {
  const file = readAccountEnvFile();
  const pick = (envKey: string, fileKey: string): string => envValue(envKey) || file[fileKey] || '';
  const credentials: RealE2ECredentials = {
    accountIssuer: pick('AGENTHUB_E2E_ACCOUNT_ISSUER', 'AGENTHUB_E2E_ACCOUNT_ISSUER'),
    hubBaseUrl: pick('AGENTHUB_E2E_HUB_BASE_URL', 'AGENTHUB_E2E_HUB_BASE_URL') || 'http://127.0.0.1:8080',
    webBaseUrl: pick('AGENTHUB_E2E_WEB_BASE_URL', 'AGENTHUB_E2E_WEB_BASE_URL') || 'http://127.0.0.1:5174',
    userEmail: pick('AGENTHUB_E2E_USER_EMAIL', 'AGENTHUB_E2E_USER_EMAIL'),
    userPassword: pick('AGENTHUB_E2E_USER_PASSWORD', 'AGENTHUB_E2E_USER_PASSWORD'),
    partnerEmail: pick('AGENTHUB_E2E_PARTNER_EMAIL', 'AGENTHUB_E2E_PARTNER_EMAIL'),
    partnerPassword: pick('AGENTHUB_E2E_PARTNER_PASSWORD', 'AGENTHUB_E2E_PARTNER_PASSWORD'),
  };
  if (!credentials.accountIssuer) return null;
  if (!credentials.userEmail || !credentials.userPassword) return null;
  if (!credentials.partnerEmail || !credentials.partnerPassword) return null;
  return credentials;
}

async function urlReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.status < 500;
  } catch {
    return false;
  }
}

async function stackIsUp(credentials: RealE2ECredentials): Promise<boolean> {
  const accountOk = await urlReachable(`${credentials.accountIssuer}/.well-known/openid-configuration`);
  const hubOk = await urlReachable(`${credentials.hubBaseUrl}/health`);
  const webOk = await urlReachable(`${credentials.webBaseUrl}${WORKBENCH_PATH}`);
  return accountOk && hubOk && webOk;
}

const credentials = loadCredentials();

/**
 * 真实 OIDC 浏览器登录：工作台触发 → TokenDance Account 登录页 → 提交凭据 →
 * consent 授权页 → 回调回 web → Hub 设置 HttpOnly session。
 * 只确认服务端 Cookie session；不读取或返回任何凭据。
 */
async function performRealOidcLogin(
  page: Page,
  email: string,
  password: string,
  accountIssuer: string,
): Promise<void> {
  await page.goto(WORKBENCH_PATH, { waitUntil: 'domcontentloaded' });

  const loginButton = page.getByRole('button', {
    name: /Continue with TokenDance Account|使用 TokenDance Account 登录/i,
  }).first();
  await expect(loginButton).toBeVisible({ timeout: 10_000 });
  await loginButton.click();

  // 真实重定向到 external Account（/oauth/authorize → login/consent）。
  // 用 toHaveURL 轮询而不是 waitForURL：后者绑定导航生命周期事件，
  // 在 vite 快速响应下会错过已提交的导航（实测 flake）。
  const accountOrigin = new URL(accountIssuer).origin;
  await expect.poll(() => {
    try {
      return new URL(page.url()).origin;
    } catch {
      return '';
    }
  }, { timeout: 20_000 }).toBe(accountOrigin);

  // TokenDance Account 的两步登录表单；test identity 不得依赖 MFA/passkey。
  const emailInput = page.getByLabel(/^(Email|邮箱)$/i);
  await expect(emailInput).toBeVisible({ timeout: 15_000 });
  await emailInput.fill(email);
  const next = page.getByRole('button', { name: /^(Next|下一步)$/i });
  await expect(next).toBeEnabled({ timeout: 10_000 });
  await next.click();
  await page.locator('input[type="password"]').fill(password);
  const submitLogin = page.getByRole('button', { name: /^(Sign in|登录)$/i });
  await expect(submitLogin).toBeEnabled({ timeout: 20_000 });
  await submitLogin.click();

  // Account consent is React UI, not a provider form submission.
  await expect(page.getByRole('heading', { name: /Allow access|允许访问/ })).toBeVisible({
    timeout: 20_000,
  });
  const approveButton = page.getByRole('button', { name: /^(Allow access|允许访问)$/i });

  // 批准授权 → redirect 回 Web（带 code + state + RFC 9207 iss）。
  // 用 framenavigated 事件捕获回调 URL：SPA 完成服务器会话交换后会立刻
  // replaceState 清掉回调路由，轮询/生命周期等待都可能错过。
  let observedCallbackUrl: string | null = null;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url().includes(CALLBACK_PATH)) {
      observedCallbackUrl = frame.url();
    }
  });
  await approveButton.click({ noWaitAfter: true });
  await expect
    .poll(() => observedCallbackUrl, {
      timeout: 30_000,
      message: 'waiting for OIDC redirect back to the web callback route',
    })
    .not.toBeNull();
  const callbackUrl = new URL(String(observedCallbackUrl));
  expect(callbackUrl.searchParams.get('code')).toBeTruthy();
  expect(callbackUrl.searchParams.get('state')).toBeTruthy();
  expect(callbackUrl.searchParams.get('iss')).toBe(accountIssuer);

  await expect(page).not.toHaveURL(/auth\/account\/callback/, { timeout: 15_000 });
  await expect.poll(async () => (await browserHubJson(page, 'get', '/client/auth/browser/session')).status, {
    timeout: 30_000, message: 'waiting for server-owned browser session',
  }).toBe(200);
}

async function hubMe(page: Page): Promise<Record<string, unknown>> {
  const response = await browserHubJson(page, 'get', '/client/auth/browser/session');
  expect(response.status).toBe(200);
  return response.body?.data?.user ?? {};
}

const hubJson = browserHubJson;

test.describe('真实 OIDC 浏览器登录与聊天动线', () => {
  test.beforeEach(async () => {
    test.skip(!credentials, 'missing test credentials: run bash scripts/e2e/provision-real-e2e-stack.sh first');
    if (credentials && !(await stackIsUp(credentials))) {
      test.skip(true, 'real stack not up: configure external Account and start hub :8080 / web :5174 first');
    }
  });

  test('真实 OIDC 浏览器登录到达已认证工作台', async ({ page }) => {
    test.setTimeout(120_000);
    const creds = credentials!;

    await performRealOidcLogin(
      page,
      creds.userEmail,
      creds.userPassword,
      creds.accountIssuer,
    );

    // hub 以真实 OIDC 映射出的用户身份应答。
    const me = await hubMe(page);
    expect(String(me.nickname ?? '').trim()).not.toBe('');
    expect(String(me.id ?? '')).toMatch(/^[0-9a-f-]{36}$/);

    // 已认证工作台：导航存在、登录浮层消失。
    await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', {
        name: /Continue with TokenDance Account|使用 TokenDance Account 登录/i,
      }),
    ).toHaveCount(0);
  });

  test('聊天收发真实落 hub（双账号好友私聊）', async ({ page, browser }) => {
    test.setTimeout(240_000);
    const creds = credentials!;

    // ── 主账号真实登录 ──
    await performRealOidcLogin(
      page,
      creds.userEmail,
      creds.userPassword,
      creds.accountIssuer,
    );
    const primaryMe = await hubMe(page);
    const primaryId = String(primaryMe.id);

    // ── 陪聊账号真实登录（独立上下文）──
    let createdSessionId: string | undefined;
    const partnerContext: BrowserContext = await browser.newContext({ baseURL: creds.webBaseUrl, locale: 'en-US' });
    try {
      const partnerPage = await partnerContext.newPage();
      await performRealOidcLogin(
        partnerPage,
        creds.partnerEmail,
        creds.partnerPassword,
        creds.accountIssuer,
      );
      const partnerMe = await hubMe(partnerPage);
      const partnerId = String(partnerMe.id);
      expect(partnerId).not.toBe(primaryId);
      expect(String(partnerMe.nickname ?? '').trim()).not.toBe('');

      // ── 建立好友关系（私聊会话要求双方为好友）──
      const contactsBefore = await hubJson(page, 'get', `${new URL(creds.webBaseUrl).origin}/client/contacts`);
      expect(contactsBefore.status).toBe(200);
      const alreadyFriends = ((contactsBefore.body?.data as unknown[] | undefined) ?? []).some(
        (contact) => (contact as Record<string, unknown>).user_id === partnerId,
      );
      if (!alreadyFriends) {
        const sendResult = await hubJson(
          page,
          'post',
          `${new URL(creds.webBaseUrl).origin}/client/contacts/friend-requests`,
          { friend_id: partnerId, message: 'real-e2e friend request' },
        );
        expect([200, 201, 409]).toContain(sendResult.status);

        const partnerRequests = await hubJson(
          partnerPage,
          'get',
          `${new URL(creds.webBaseUrl).origin}/client/contacts/friend-requests`,
        );
        expect(partnerRequests.status).toBe(200);
        // ListFriendRequests 只返回发给当前用户的 pending 请求；
        // DTO 字段为 request_id / user_id（发送者，契约见
        // hub-server/internal/service/contact/service.go RequestInfo）。
        const pendingRequest = ((partnerRequests.body?.data as unknown[] | undefined) ?? [])
          .map((item) => item as Record<string, unknown>)
          .find((item) => item.user_id === primaryId);
        expect(pendingRequest).toBeTruthy();
        const requestId = String(pendingRequest?.request_id ?? pendingRequest?.id ?? '');
        expect(requestId).toBeTruthy();
        const acceptResult = await hubJson(
          partnerPage,
          'post',
          `${new URL(creds.webBaseUrl).origin}/client/contacts/friend-requests/${requestId}/accept`,
          {},
        );
        expect([200, 201]).toContain(acceptResult.status);

        await expect
          .poll(async () => {
            const contacts = await hubJson(page, 'get', `${new URL(creds.webBaseUrl).origin}/client/contacts`);
            const list = ((contacts.body?.data as unknown[] | undefined) ?? []).map(
              (contact) => contact as Record<string, unknown>,
            );
            return list.some((contact) => contact.user_id === partnerId);
          }, { timeout: 15_000, message: 'waiting for friendship to be accepted' })
          .toBe(true);
      }

      const sessionsResult = await hubJson(page, 'get', '/client/sessions');
      expect(sessionsResult.status).toBe(200);
      const existingIds = new Set(((sessionsResult.body?.data as Record<string, unknown>[]) ?? []).map((item) => String(item.id ?? item.session_id)));
      // ── 创建私聊会话（真实 hub；self 目标被服务拒绝，故用陪聊账号）──
      const sessionResult = await hubJson(
        page,
        'post',
        `${new URL(creds.webBaseUrl).origin}/client/sessions/private`,
        { target_user_id: partnerId },
      );
      expect([200, 201]).toContain(sessionResult.status);
      const sessionId = String((sessionResult.body?.data as Record<string, unknown> | undefined)?.session_id ?? '');
      expect(sessionId).toBeTruthy();
      if (!existingIds.has(sessionId)) createdSessionId = sessionId;
      await page.reload();

      // ── 侧栏出现该会话（会话列表 10s 轮询，放宽到 40s）──
      // 以刚读取的对方显示名找到新会话，不依赖旧侧栏的 DOM 实现。
      const sessionButton = page.getByRole('button', { name: String(partnerMe.nickname ?? partnerMe.username), exact: true });
      await expect(sessionButton).toBeVisible({ timeout: 40_000 });
      await sessionButton.click();

      // ── 发送消息并断言 UI 可见 ──
      const composer = page.locator('textarea[data-composer-input]').first();
      await expect(composer).toBeVisible({ timeout: 15_000 });
      const messageMarker = `real-e2e ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await composer.click();
      await composer.fill(messageMarker);
      await composer.press('Enter');
      await expect(page.getByText(messageMarker).first()).toBeVisible({ timeout: 20_000 });

      // ── 消息真实落 hub：双方视角都能读到 ──
      const messageUrl = `${new URL(creds.webBaseUrl).origin}/client/sessions/${sessionId}/messages`;
      const containsMarker = async (actorPage: Page): Promise<boolean> => {
        const result = await hubJson(actorPage, 'get', messageUrl);
        const list = ((result.body?.data as unknown[] | undefined) ?? []).map(
          (message) => message as Record<string, unknown>,
        );
        return list.some((message) => String(message.content ?? '').includes(messageMarker));
      };
      await expect
        .poll(() => containsMarker(page), { timeout: 15_000, message: 'sender-side hub persistence' })
        .toBe(true);
      await expect
        .poll(() => containsMarker(partnerPage), { timeout: 15_000, message: 'receiver-side hub persistence' })
        .toBe(true);
    } finally {
      try {
        if (createdSessionId) {
          const result = await hubJson(page, 'delete', `/client/sessions/${encodeURIComponent(createdSessionId)}`);
          expect(result.status, 'delete only the conversation created by this run').toBe(200);
        }
      } finally {
        await partnerContext.close();
      }
    }
  });
});
