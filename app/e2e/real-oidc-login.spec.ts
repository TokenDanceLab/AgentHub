import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AgentHub real OIDC browser E2E — 真浏览器 × 真本地栈（#1839 B2）。
 *
 * 与 chat-real.spec.ts（dev-secret 自签 JWT 旁路 + API 级断言）互补：
 * 本 spec 走真实的 TokenDance ID OIDC Authorization Code + PKCE 浏览器
 * 登录动线（禁用任何自签 JWT/旁路），并断言聊天消息真实落 hub。
 *
 * 前置（本机全栈：TokenDance ID :3000 / hub :8080 / edge :3210 / web :5174）：
 *   bash scripts/e2e/provision-real-e2e-stack.sh
 *   （供给测试账号并落凭据到 tests/artifacts/real-e2e-account.env，gitignored）
 *
 * 运行：
 *   cd app/web && pnpm exec playwright test --config playwright.real.config.ts \
 *     --project=chromium real-oidc-login.spec.ts
 *
 * 证据等级：observed-local（real_tested=true，本地单机真栈）。
 * CI 状态：不进 CI（与 playwright.real.config.ts 同语义，仅本地真栈运行）。
 */

interface RealE2ECredentials {
  idBaseUrl: string;
  hubBaseUrl: string;
  webBaseUrl: string;
  userEmail: string;
  userPassword: string;
  partnerEmail: string;
  partnerPassword: string;
}

interface HubEnvelope<T> {
  code: string;
  data: T;
}

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SPEC_DIR, '..', '..');
const ACCOUNT_ENV_PATH = path.join(REPO_ROOT, 'tests', 'artifacts', 'real-e2e-account.env');
const WORKBENCH_PATH = '/workbench/';
const CALLBACK_PATH = '/workbench/auth/tokendance/callback';
const HUB_TOKEN_STORAGE_KEY = 'agenthub_hub_token';
const PRIMARY_DISPLAY_NAME = 'AgentHub E2E User';
const PARTNER_DISPLAY_NAME = 'AgentHub E2E Partner';

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
    idBaseUrl: pick('AGENTHUB_E2E_ID_BASE_URL', 'AGENTHUB_E2E_ID_BASE_URL') || 'http://127.0.0.1:3000',
    hubBaseUrl: pick('AGENTHUB_E2E_HUB_BASE_URL', 'AGENTHUB_E2E_HUB_BASE_URL') || 'http://127.0.0.1:8080',
    webBaseUrl: pick('AGENTHUB_E2E_WEB_BASE_URL', 'AGENTHUB_E2E_WEB_BASE_URL') || 'http://127.0.0.1:5174',
    userEmail: pick('AGENTHUB_E2E_USER_EMAIL', 'AGENTHUB_E2E_USER_EMAIL'),
    userPassword: pick('AGENTHUB_E2E_USER_PASSWORD', 'AGENTHUB_E2E_USER_PASSWORD'),
    partnerEmail: pick('AGENTHUB_E2E_PARTNER_EMAIL', 'AGENTHUB_E2E_PARTNER_EMAIL'),
    partnerPassword: pick('AGENTHUB_E2E_PARTNER_PASSWORD', 'AGENTHUB_E2E_PARTNER_PASSWORD'),
  };
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
  const idOk = await urlReachable(`${credentials.idBaseUrl}/.well-known/openid-configuration`);
  const hubOk = await urlReachable(`${credentials.hubBaseUrl}/health`);
  const webOk = await urlReachable(`${credentials.webBaseUrl}${WORKBENCH_PATH}`);
  return idOk && hubOk && webOk;
}

const credentials = loadCredentials();

/**
 * 本机离线环境无法加载 Cloudflare Turnstile CDN 脚本；abort 触发前端组件的
 * 错误分支从而允许提交。服务端 Turnstile 校验未配置 secret 时恒通过
 * （TokenDance ID 源码注释明示），故此处理不构成任何安全旁路。
 */
async function blockTurnstileCdn(context: BrowserContext): Promise<void> {
  await context.route('**/challenges.cloudflare.com/**', (route) => route.abort());
}

/**
 * 真实 OIDC 浏览器登录：工作台触发 → TokenDance ID 登录页 → 提交凭据 →
 * consent 授权页 → 回调回 web → hub 交换出会话 token。
 * 返回登录后 sessionStorage 中 hub 颁发的 access token。
 */
async function performRealOidcLogin(page: Page, email: string, password: string, idBaseUrl: string): Promise<string> {
  await page.goto(WORKBENCH_PATH, { waitUntil: 'domcontentloaded' });

  // 未认证时工作台无直接登录按钮；在 composer 提交触发 ensureAuth 打开登录浮层。
  const composer = page.locator('textarea[data-composer-input]').first();
  await composer.click();
  await composer.fill('real-e2e: open sign-in');
  await composer.press('Enter');

  const loginButton = page.getByRole('button', { name: /Continue with TokenDance|使用 TokenDance ID 登录/i }).first();
  await expect(loginButton).toBeVisible({ timeout: 10_000 });
  await loginButton.click();

  // 真实重定向到 TokenDance ID（OIDC authorize → 302 到 /login）。
  // 用 toHaveURL 轮询而不是 waitForURL：后者绑定导航生命周期事件，
  // 在 vite 快速响应下会错过已提交的导航（实测 flake）。
  const idHost = new URL(idBaseUrl).host.replace(/\./g, '\\.');
  await expect(page).toHaveURL(new RegExp(`${idHost}/login`), { timeout: 20_000 });

  // TokenDance ID 真实登录表单。
  await expect(page.locator('#login-email')).toBeVisible({ timeout: 15_000 });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  const submitLogin = page.locator('button.login-submit');
  await expect(submitLogin).toBeEnabled({ timeout: 20_000 });
  await submitLogin.click();

  // consent 授权页（服务端渲染；client 未信任且 prompt=consent）。
  const consentForm = page.locator('form[action="/oidc/authorize/confirm"]');
  await expect(consentForm).toBeVisible({ timeout: 20_000 });
  const authorizationRequestId = await consentForm.locator('input[name="authorization_request_id"]').inputValue();
  expect(authorizationRequestId.length).toBeGreaterThan(0);
  const approveButton = consentForm.locator('button[type="submit"]');
  await expect(approveButton).toBeVisible();

  // 批准授权 → 302 回 web 回调（带 code + state）。
  // 用 framenavigated 事件捕获回调 URL：SPA 换完 token 后会立刻
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

  // web SPA 用 PKCE verifier 与 hub 交换真实会话（无旁路）。
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), HUB_TOKEN_STORAGE_KEY), {
      timeout: 30_000,
      message: 'waiting for hub-issued session after real OIDC code exchange',
    })
    .not.toBeNull();

  // 回调路由被清理，回到工作台。
  await expect(page).not.toHaveURL(/auth\/tokendance\/callback/, { timeout: 15_000 });
  const token = await page.evaluate((key) => sessionStorage.getItem(key), HUB_TOKEN_STORAGE_KEY);
  expect(token).toBeTruthy();
  return String(token);
}

async function hubMe(request: { get: Function }, hubBaseUrl: string, token: string): Promise<Record<string, unknown>> {
  const response = await request.get(`${hubBaseUrl}/client/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as HubEnvelope<Record<string, unknown>>;
  expect(body.code).toBe('ok');
  return body.data;
}

async function hubJson(
  request: { get: Function; post: Function; delete: Function },
  method: 'get' | 'post' | 'delete',
  url: string,
  token: string,
  data?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const options: Record<string, unknown> = { headers: { Authorization: `Bearer ${token}` } };
  if (data) options.data = data;
  const response = await request[method](url, options);
  const text = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  return { status: response.status(), body };
}

test.describe('真实 OIDC 浏览器登录与聊天动线', () => {
  test.beforeEach(async () => {
    test.skip(!credentials, 'missing test credentials: run bash scripts/e2e/provision-real-e2e-stack.sh first');
    if (credentials && !(await stackIsUp(credentials))) {
      test.skip(true, 'local real stack not up: start TokenDance ID :3000 / hub :8080 / web :5174 (start.sh) first');
    }
  });

  test('真实 OIDC 浏览器登录到达已认证工作台', async ({ page }) => {
    test.setTimeout(120_000);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- beforeAll skip 已保证非空
    const creds = credentials!;
    await blockTurnstileCdn(page.context());

    const token = await performRealOidcLogin(page, creds.userEmail, creds.userPassword, creds.idBaseUrl);

    // hub 以真实 OIDC 映射出的用户身份应答。
    const me = await hubMe(page.request, creds.hubBaseUrl, token);
    expect(me.nickname).toBe(PRIMARY_DISPLAY_NAME);
    expect(String(me.id ?? '')).toMatch(/^[0-9a-f-]{36}$/);

    // 已认证工作台：导航存在、登录浮层消失。
    await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: /Continue with TokenDance|使用 TokenDance ID 登录/i }),
    ).toHaveCount(0);
  });

  test('聊天收发真实落 hub（双账号好友私聊）', async ({ page, browser }) => {
    test.setTimeout(240_000);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- beforeAll skip 已保证非空
    const creds = credentials!;
    await blockTurnstileCdn(page.context());

    // ── 主账号真实登录 ──
    const primaryToken = await performRealOidcLogin(page, creds.userEmail, creds.userPassword, creds.idBaseUrl);
    const primaryMe = await hubMe(page.request, creds.hubBaseUrl, primaryToken);
    const primaryId = String(primaryMe.id);

    // ── 陪聊账号真实登录（独立上下文）──
    const partnerContext: BrowserContext = await browser.newContext({ locale: 'en-US' });
    try {
      await blockTurnstileCdn(partnerContext);
      const partnerPage = await partnerContext.newPage();
      const partnerToken = await performRealOidcLogin(
        partnerPage,
        creds.partnerEmail,
        creds.partnerPassword,
        creds.idBaseUrl,
      );
      const partnerMe = await hubMe(partnerPage.request, creds.hubBaseUrl, partnerToken);
      const partnerId = String(partnerMe.id);
      expect(partnerId).not.toBe(primaryId);
      expect(partnerMe.nickname).toBe(PARTNER_DISPLAY_NAME);

      // ── 建立好友关系（私聊会话要求双方为好友）──
      const contactsBefore = await hubJson(page.request, 'get', `${creds.hubBaseUrl}/client/contacts`, primaryToken);
      expect(contactsBefore.status).toBe(200);
      const alreadyFriends = ((contactsBefore.body?.data as unknown[] | undefined) ?? []).some(
        (contact) => (contact as Record<string, unknown>).user_id === partnerId,
      );
      if (!alreadyFriends) {
        const sendResult = await hubJson(
          page.request,
          'post',
          `${creds.hubBaseUrl}/client/contacts/friend-requests`,
          primaryToken,
          { friend_id: partnerId, message: 'real-e2e friend request' },
        );
        expect([200, 201, 409]).toContain(sendResult.status);

        const partnerRequests = await hubJson(
          partnerPage.request,
          'get',
          `${creds.hubBaseUrl}/client/contacts/friend-requests`,
          partnerToken,
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
          partnerPage.request,
          'post',
          `${creds.hubBaseUrl}/client/contacts/friend-requests/${requestId}/accept`,
          partnerToken,
          {},
        );
        expect([200, 201]).toContain(acceptResult.status);

        await expect
          .poll(async () => {
            const contacts = await hubJson(page.request, 'get', `${creds.hubBaseUrl}/client/contacts`, primaryToken);
            const list = ((contacts.body?.data as unknown[] | undefined) ?? []).map(
              (contact) => contact as Record<string, unknown>,
            );
            return list.some((contact) => contact.user_id === partnerId);
          }, { timeout: 15_000, message: 'waiting for friendship to be accepted' })
          .toBe(true);
      }

      // ── 清理主账号既有会话，保证侧栏只出现本测试创建的会话 ──
      const sessionsResult = await hubJson(page.request, 'get', `${creds.hubBaseUrl}/client/sessions`, primaryToken);
      expect(sessionsResult.status).toBe(200);
      for (const raw of (sessionsResult.body?.data as unknown[] | undefined) ?? []) {
        const session = raw as Record<string, unknown>;
        const sessionId = String(session.id ?? session.session_id ?? '');
        if (sessionId) {
          await hubJson(page.request, 'delete', `${creds.hubBaseUrl}/client/sessions/${sessionId}`, primaryToken);
        }
      }

      // ── 创建私聊会话（真实 hub；self 目标被服务拒绝，故用陪聊账号）──
      const sessionResult = await hubJson(
        page.request,
        'post',
        `${creds.hubBaseUrl}/client/sessions/private`,
        primaryToken,
        { target_user_id: partnerId },
      );
      expect([200, 201]).toContain(sessionResult.status);
      const sessionId = String((sessionResult.body?.data as Record<string, unknown> | undefined)?.session_id ?? '');
      expect(sessionId).toBeTruthy();

      // ── 侧栏出现该会话（会话列表 10s 轮询，放宽到 40s）──
      const sessionButton = page.locator('button', { hasText: 'Hub 私聊' }).first();
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
      const messageUrl = `${creds.hubBaseUrl}/client/sessions/${sessionId}/messages`;
      const containsMarker = async (token: string): Promise<boolean> => {
        const result = await hubJson(page.request, 'get', messageUrl, token);
        const list = ((result.body?.data as unknown[] | undefined) ?? []).map(
          (message) => message as Record<string, unknown>,
        );
        return list.some((message) => String(message.content ?? '').includes(messageMarker));
      };
      await expect
        .poll(() => containsMarker(primaryToken), { timeout: 15_000, message: 'sender-side hub persistence' })
        .toBe(true);
      await expect
        .poll(() => containsMarker(partnerToken), { timeout: 15_000, message: 'receiver-side hub persistence' })
        .toBe(true);
    } finally {
      await partnerContext.close();
    }
  });
});
