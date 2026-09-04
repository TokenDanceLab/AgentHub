import crypto from 'node:crypto';
import fs from 'node:fs';
import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';

/**
 * AgentHub Golden Flows（round-74 Phase 3）——最薄的「用户真实操作」验收层。
 *
 * 纪律（AGENTS §5.5 L3 + #1839）：
 *  - 只复用既有 real lane（playwright.real.config.ts + run-real-e2e-lane.sh），不引入新框架；
 *  - 全程真实 OIDC Authorization Code + PKCE（无自签 JWT、无 stub hub）；
 *  - agent 回复消息经**真实 Edge→Hub 回调契约**（/edge/agent-tasks/:id/ack|stream|done）
 *    产生，而不是直接写库；唯一非真实部件是模型 runner 本身（由本 spec 代答）。
 *
 * 四条流：
 *  GF1 真登录后主界面拿到真实数据（会话与消息来自 Hub，不是 demo）；
 *  GF2 「重新生成」用真 task identity 且成功（#2274 B-1 的回归门）；
 *  GF3 未登录 demo 不提供会失败的「重新生成」（B-1 的诚实门回归）；
 *  GF4 Edge 回调落地后 transcript 无需手动刷新（round-73 invalidation 修复的回归门）。
 */

const ID = process.env.AGENTHUB_E2E_ID_BASE_URL || 'http://127.0.0.1:3000';
const HUB = process.env.AGENTHUB_E2E_HUB_BASE_URL || 'http://127.0.0.1:8080';
const WEB = process.env.AGENTHUB_E2E_WEB_BASE_URL || 'http://127.0.0.1:5174';
const WEB_CALLBACK = `${WEB}/workbench/auth/tokendance/callback`;
const ACCOUNT_ENV = `${process.env.AGENTHUB_E2E_ACCOUNT_ENV || '/root/agenthub-dev/AgentHub/tests/artifacts/real-e2e-account.env'}`;

function readAccountEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(ACCOUNT_ENV)) return out;
  for (const line of fs.readFileSync(ACCOUNT_ENV, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const creds = readAccountEnv();

function pkce(): { verifier: string; challenge: string } {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let verifier = '';
  const bytes = crypto.randomBytes(64);
  for (let i = 0; i < 64; i += 1) verifier += alphabet[bytes[i]! % alphabet.length];
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

interface HubSession { token: string; userId: string }

/** 真实 Authorization Code + PKCE：ID 登录 → hub authorize → consent → hub callback。 */
async function realHubSession(api: APIRequestContext, email: string, password: string, deviceType: 'web' | 'desktop'): Promise<HubSession> {
  // ID 对 /api/auth/login 按 IP 限流（实测窗口内第 3 次起 429）：按 Retry-After
  // 退避重试，而不是把限流当成登录失败。
  let loginStatus = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const login = await api.post(`${ID}/api/auth/login`, { data: { email, password }, maxRedirects: 0 });
    loginStatus = login.status();
    if (loginStatus === 200) break;
    if (loginStatus !== 429) break;
    const retryAfter = Number(login.headers()['retry-after'] ?? '0') || 10 * (attempt + 1);
    await new Promise((resolve) => { setTimeout(resolve, retryAfter * 1000); });
  }
  expect(loginStatus, `ID login for ${deviceType}`).toBe(200);

  const { verifier, challenge } = pkce();
  const deviceId = crypto.randomUUID();
  const authorize = await api.post(`${HUB}/client/auth/oidc/authorize`, {
    data: { code_challenge: challenge, code_challenge_method: 'S256', device_type: deviceType, device_id: deviceId, redirect_uri: WEB_CALLBACK },
  });
  expect(authorize.status()).toBe(200);
  const az = (await authorize.json()).data as { state: string; authorization_url: string };

  let code: string | null = null;
  const first = await api.get(az.authorization_url, { maxRedirects: 0 });
  if ([302, 303, 307].includes(first.status())) {
    code = new URL(first.headers().location ?? '', ID).searchParams.get('code');
  } else {
    expect(first.status()).toBe(200);
    const html = await first.text();
    const form = html.match(/<form[^>]+action="\/oidc\/authorize\/confirm"[^>]*>([\s\S]*?)<\/form>/);
    const formBody = form?.[1];
    expect(formBody, 'consent form present').toBeTruthy();
    const fields: Record<string, string> = {};
    for (const m of (formBody ?? '').matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)) fields[m[1] ?? ''] = m[2] ?? '';
    const confirm = await api.post(`${ID}/oidc/authorize/confirm`, {
      data: new URLSearchParams(fields).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      maxRedirects: 0,
    });
    expect([302, 303, 307].includes(confirm.status()), `consent confirm status ${confirm.status()}`).toBe(true);
    code = new URL(confirm.headers().location ?? '', ID).searchParams.get('code');
  }
  expect(code, 'authorization code obtained').not.toBeNull();

  const callback = await api.post(`${HUB}/client/auth/oidc/callback`, {
    data: { code, state: az.state, code_verifier: verifier, device_type: deviceType, device_id: deviceId, redirect_uri: WEB_CALLBACK },
  });
  expect(callback.status(), 'hub oidc callback').toBe(200);
  const body = (await callback.json()).data as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

async function hubJson(api: APIRequestContext, method: 'get' | 'post', path: string, token: string, data?: unknown) {
  const res = await api[method === 'get' ? 'get' : 'post'](`${HUB}${path}`, {
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status(), body: (await res.json().catch(() => null)) as Record<string, any> | null };
}

interface Provisioned {
  sessionId: string;
  taskId: string;
  agentReplyText: string;
  sessionName: string;
}

/** 真数据：group 会话 → agent 实例 → 用户消息 → 任务 → 真实 Edge 回调产出 agent 回复。 */
async function provisionConversation(api: APIRequestContext, web: HubSession, desktop: HubSession, label: string): Promise<Provisioned> {
  const sessionName = `GF ${label} ${crypto.randomBytes(3).toString('hex')}`;
  const session = await hubJson(api, 'post', '/client/sessions', web.token, { type: 'group', name: sessionName, member_ids: [] });
  expect(session.status, 'create group session').toBe(200);
  const sessionId = (session.body?.data?.session_id ?? session.body?.data?.id) as string;
  expect(sessionId, 'session id in create response').toBeTruthy();

  const agent = await hubJson(api, 'post', `/client/sessions/${sessionId}/agents`, web.token, { agent_type: 'claude-code', display_name: 'GF Agent' });
  expect(agent.status, 'add agent').toBe(200);
  const agentInstanceId = agent.body?.data?.id as string;

  const msg = await hubJson(api, 'post', `/client/sessions/${sessionId}/messages`, web.token, {
    content_type: 'text',
    content: JSON.stringify({ content: `${label}: please answer once.` }),
  });
  expect(msg.status, 'send trigger message').toBe(200);
  const triggerMessageId = (msg.body?.data?.message_id ?? msg.body?.data?.id) as string;
  expect(triggerMessageId, 'message id in send response').toBeTruthy();

  const task = await hubJson(api, 'post', '/web/agent-tasks', web.token, { trigger_message_id: triggerMessageId, agent_instance_id: agentInstanceId });
  expect(task.status, 'trigger task').toBe(200);
  const taskId = task.body?.data?.id as string;

  const runId = `gf-run-${crypto.randomBytes(6).toString('hex')}`;
  const agentReplyText = `${label}: final answer from the real Edge callback contract.`;
  for (const [path, payload] of [
    [`/edge/agent-tasks/${taskId}/ack`, { edge_run_id: runId }],
    [`/edge/agent-tasks/${taskId}/stream`, { edge_run_id: runId, event_type: 'output', content: `${label}: thinking...` }],
    [`/edge/agent-tasks/${taskId}/done`, { edge_run_id: runId, final_content: agentReplyText }],
  ] as Array<[string, unknown]>) {
    const res = await api.post(`${HUB}${path}`, { data: payload, headers: { Authorization: `Bearer ${desktop.token}` } });
    expect(res.status(), `edge callback ${path.split('/').pop()}`).toBe(200);
  }
  return { sessionId, taskId, agentReplyText, sessionName };
}

/** 真浏览器 OIDC 登录（与 real-oidc-login.spec.ts 同一路径）。 */
async function loginInBrowser(page: Page): Promise<void> {
  await page.goto(`${WEB}/workbench/`, { waitUntil: 'domcontentloaded' });
  const composer = page.locator('textarea[data-composer-input]').first();
  await composer.click();
  await composer.fill('golden-flow: open sign-in');
  await composer.press('Enter');
  await page.getByRole('button', { name: /Continue with TokenDance|使用 TokenDance ID 登录/i }).first().click();
  const idHost = new URL(ID).host.replace(/\./g, '\\.');
  await expect(page).toHaveURL(new RegExp(`${idHost}/login`), { timeout: 25_000 });
  await page.locator('#login-email').fill(creds.AGENTHUB_E2E_USER_EMAIL ?? '');
  await page.locator('#login-password').fill(creds.AGENTHUB_E2E_USER_PASSWORD ?? '');
  // ID 按 IP 限流 /api/auth/login：并行 spec 会消耗配额，提交后可能停在登录页。
  // 表单值保留，所以限流窗口过后重提交即可自愈（不把限流当登录失败）。
  const consent = page.locator('form[action="/oidc/authorize/confirm"]');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.locator('button.login-submit').click();
    const appeared = await consent.waitFor({ timeout: 12_000 }).then(() => true).catch(() => false);
    if (appeared) break;
    if (attempt === 3) await consent.waitFor({ timeout: 25_000 });
    await page.waitForTimeout(15_000);
  }
  await consent.locator('button[type="submit"]').click();
  await page.waitForURL('**/workbench/**', { timeout: 30_000 });
  await page.waitForFunction(() => sessionStorage.getItem('agenthub_hub_token') !== null, null, { timeout: 30_000 });
}

async function openSessionByName(page: Page, name: string): Promise<void> {
  const row = page.locator('[role="listbox"] [role="option"] button', { hasText: name }).first();
  await row.click({ timeout: 25_000 });
  await page.waitForTimeout(1500);
}

/** 右键一个 transcript 块并点「重新生成」；返回菜单是否提供该条目。 */
async function clickRegenerate(page: Page, block: import('@playwright/test').Locator): Promise<boolean> {
  const target = block.first();
  await target.scrollIntoViewIfNeeded({ timeout: 8000 });
  try {
    await target.click({ button: 'right', force: true, timeout: 8000 });
  } catch {
    const box = await target.boundingBox();
    if (!box) return false;
    await target.dispatchEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: box.x + 20, clientY: box.y + 10 });
  }
  await page.waitForTimeout(600);
  const item = page.locator('[role="menuitem"]', { hasText: /Regenerate|重新生成/ }).first();
  if (!(await item.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape');
    return false;
  }
  await item.click();
  return true;
}

test.describe('AgentHub Golden Flows（真实栈）', () => {
  // 串行：四条流共享同一个 IP 的 ID 登录配额，并行只会互相限流。
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  // ID 对 /api/auth/login 按 IP 限流（实测连续第 3 次起 429）：整个 describe 只登录
  // 一次，web/desktop 两种 device_type 的 hub 会话共用同一个 ID cookie jar 派生。
  let sharedApi: APIRequestContext;
  let webSession: HubSession;
  let desktopSession: HubSession;

  test.beforeAll(async () => {
    sharedApi = await pwRequest.newContext();
    webSession = await realHubSession(sharedApi, creds.AGENTHUB_E2E_USER_EMAIL ?? '', creds.AGENTHUB_E2E_USER_PASSWORD ?? '', 'web');
    desktopSession = await realHubSession(sharedApi, creds.AGENTHUB_E2E_USER_EMAIL ?? '', creds.AGENTHUB_E2E_USER_PASSWORD ?? '', 'desktop');
  });

  test.afterAll(async () => {
    await sharedApi?.dispose();
  });

  test('GF1 真登录后主界面拿到真实 Hub 数据（会话与消息非 demo）', async ({ request, browser }) => {
    const prov = await provisionConversation(sharedApi, webSession, desktopSession, 'GF1');

    const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, locale: 'en-US' });
    await context.route('**/challenges.cloudflare.com/**', (r) => r.abort());
    const page = await context.newPage();
    await loginInBrowser(page);
    await openSessionByName(page, prov.sessionName);
    // 真数据断言：用户消息与 agent 回复都来自 Hub（文本逐字匹配 provisioning 内容）。
    await expect(page.getByText(prov.agentReplyText).first()).toBeVisible({ timeout: 20_000 });
    await context.close();
  });

  test('GF2 「重新生成」发真 task id 且成功（#2274 B-1 回归门）', async ({ request, browser }) => {
    const prov = await provisionConversation(sharedApi, webSession, desktopSession, 'GF2');

    const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, locale: 'en-US' });
    await context.route('**/challenges.cloudflare.com/**', (r) => r.abort());
    const page = await context.newPage();
    const regenerateCalls: Array<{ url: string; status: number }> = [];
    page.on('response', (res) => {
      if (res.url().includes('/regenerate')) regenerateCalls.push({ url: res.url(), status: res.status() });
    });
    await loginInBrowser(page);
    await openSessionByName(page, prov.sessionName);
    const block = page.locator('[data-block-id^="hub-message-"]', { hasText: prov.agentReplyText }).first();
    await expect(block).toBeVisible({ timeout: 20_000 });

    const offered = await clickRegenerate(page, page.locator('[data-block-id^="hub-message-"]').filter({ hasText: prov.agentReplyText }));
    expect(offered, 'regenerate entry offered for a stamped agent reply').toBe(true);

    await expect.poll(() => regenerateCalls.length, { timeout: 15_000 }).toBeGreaterThan(0);
    // 身份合同：URL 里必须是**任务 id**，且请求成功（B-1 修复前这里是 message/client_msg id + 404）。
    expect(regenerateCalls[0]!.url).toContain(`/web/agent-tasks/${prov.taskId}/regenerate`);
    expect(regenerateCalls[0]!.status).toBe(200);
    await expect(page.getByText(/Regenerating|重新生成中/i).first()).toBeVisible({ timeout: 10_000 });
    await context.close();
  });

  test('GF3 未登录 demo 不提供会失败的「重新生成」（诚实门回归）', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, locale: 'en-US' });
    await context.route('**/challenges.cloudflare.com/**', (r) => r.abort());
    const page = await context.newPage();
    const regenerateCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/regenerate')) regenerateCalls.push(req.url());
    });
    await page.goto(`${WEB}/workbench/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    expect(await page.evaluate(() => sessionStorage.getItem('agenthub_hub_token') !== null)).toBe(false);

    const blocks = await page.evaluate(() => Array.from(document.querySelectorAll('[data-block-id]')).map((e) => e.getAttribute('data-block-id') ?? ''));
    expect(blocks.length, 'demo transcript renders blocks').toBeGreaterThan(0);
    for (const id of blocks.slice(0, 6)) {
      const offered = await clickRegenerate(page, page.locator(`[data-block-id="${id}"]`));
      expect(offered, `demo block ${id} must not offer regenerate`).toBe(false);
    }
    expect(regenerateCalls).toEqual([]);
    await context.close();
  });

  test('GF4 Edge 回调落地后 transcript 无需手动刷新（invalidation 回归门）', async ({ request, browser }) => {
    const prov = await provisionConversation(sharedApi, webSession, desktopSession, 'GF4');

    const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, locale: 'en-US' });
    await context.route('**/challenges.cloudflare.com/**', (r) => r.abort());
    const page = await context.newPage();
    await loginInBrowser(page);
    await openSessionByName(page, prov.sessionName);
    await expect(page.getByText(prov.agentReplyText).first()).toBeVisible({ timeout: 20_000 });

    // 页面保持打开：再触发一个任务并走真实回调，新 agent 消息必须自己出现。
    const msg2 = await hubJson(sharedApi, 'post', `/client/sessions/${prov.sessionId}/messages`, webSession.token, {
      content_type: 'text',
      content: JSON.stringify({ content: 'GF4: second question, answer again.' }),
    });
    expect(msg2.status).toBe(200);
    const task2 = await hubJson(sharedApi, 'post', '/web/agent-tasks', webSession.token, {
      trigger_message_id: msg2.body?.data?.message_id,
      agent_instance_id: (await hubJson(sharedApi, 'post', `/client/sessions/${prov.sessionId}/agents`, webSession.token, { agent_type: 'claude-code', display_name: 'GF Agent 2' })).body?.data?.id,
    });
    expect(task2.status).toBe(200);
    const taskId2 = task2.body?.data?.id as string;
    const runId2 = `gf-run2-${crypto.randomBytes(6).toString('hex')}`;
    const secondReply = 'GF4: second answer arrived without a manual reload.';
    for (const [path, payload] of [
      [`/edge/agent-tasks/${taskId2}/ack`, { edge_run_id: runId2 }],
      [`/edge/agent-tasks/${taskId2}/done`, { edge_run_id: runId2, final_content: secondReply }],
    ] as Array<[string, unknown]>) {
      const res = await sharedApi.post(`${HUB}${path}`, { data: payload, headers: { Authorization: `Bearer ${desktopSession.token}` } });
      expect(res.status(), `edge callback ${path.split('/').pop()}`).toBe(200);
    }
    // 无 reload、无手动 refetch：WS/invalidation 必须把新消息带进 DOM。
    await expect(page.getByText(secondReply).first()).toBeVisible({ timeout: 30_000 });
    await context.close();
  });
});
