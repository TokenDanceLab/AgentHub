import { browserHubJson } from './browserCookieSession';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, request as pwRequest, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

/**
 * AgentHub Golden Flows ——最薄的「用户真实操作」验收层。
 *
 * 纪律（AGENTS §5「测试分层（L0-L4）」L3）：
 *  - 只复用既有 real lane（playwright.real.config.ts + run-real-e2e-lane.sh），不引入新框架；
 *  - 全程真实 OIDC Authorization Code + PKCE（无自签 JWT、无 stub hub）；
 *  - agent 回复消息经**真实 Edge→Hub 回调契约**（/edge/agent-tasks/:id/ack|stream|done）
 *    产生，而不是直接写库；唯一非真实部件是模型 runner 本身（由本 spec 代答）。
 *  - 回调必须预配 AGENTHUB_E2E_EDGE_TOKEN 和对应 AGENTHUB_E2E_EDGE_TARGET_ID；
 *    Web 仅使用 HttpOnly Cookie，不抽取或复制浏览器凭据来冒充设备。
 *
 * 四条流：
 *  GF1 真登录后主界面拿到真实数据（会话与消息来自 Hub，不是 demo）；
 *  GF2 「重新生成」用真 task identity 且成功（#2274 回归门）；
 *  GF3 未登录时只显示登录入口，不泄露会话或提供「重新生成」；
 *  GF4 Edge 回调落地后 transcript 无需手动刷新（缓存失效回归门）。
 */

const HUB = process.env.AGENTHUB_E2E_HUB_BASE_URL || 'http://127.0.0.1:8080';
const WEB = process.env.AGENTHUB_E2E_WEB_BASE_URL || 'http://127.0.0.1:5174';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const EDGE_TOKEN = process.env.AGENTHUB_E2E_EDGE_TOKEN || '';
const EDGE_TARGET_ID = process.env.AGENTHUB_E2E_EDGE_TARGET_ID || '';
const createdSessionIds = new Set<string>();
const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SPEC_DIR, '..', '..');
const ACCOUNT_ENV = process.env.AGENTHUB_E2E_ACCOUNT_ENV
  || path.join(REPO_ROOT, 'tests', 'artifacts', 'real-e2e-account.env');

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
const ACCOUNT_ISSUER = process.env.AGENTHUB_E2E_ACCOUNT_ISSUER
  || creds.AGENTHUB_E2E_ACCOUNT_ISSUER
  || '';
const USER_EMAIL = process.env.AGENTHUB_E2E_USER_EMAIL || creds.AGENTHUB_E2E_USER_EMAIL || '';
const USER_PASSWORD = process.env.AGENTHUB_E2E_USER_PASSWORD || creds.AGENTHUB_E2E_USER_PASSWORD || '';

interface HubSession { page: Page; userId: string }
interface EdgeSession { token: string; targetId: string }

const hubJson = browserHubJson;

interface Provisioned {
  sessionId: string;
  taskId: string;
  agentReplyText: string;
  sessionName: string;
}

/** 真数据：group 会话 → agent 实例 → 用户消息 → 任务 → 真实 Edge 回调产出 agent 回复。 */
async function provisionConversation(api: APIRequestContext, web: HubSession, edge: EdgeSession, label: string): Promise<Provisioned> {
  const sessionName = `GF ${label} ${crypto.randomBytes(3).toString('hex')}`;
  const session = await hubJson(web.page, 'post', '/client/sessions/group', { name: sessionName, member_ids: [] });
  expect(session.status, 'create group session').toBe(200);
  const sessionId = (session.body?.data?.session_id ?? session.body?.data?.id) as string;
  expect(sessionId, 'session id in create response').toBeTruthy();
  createdSessionIds.add(sessionId);

  const agent = await hubJson(web.page, 'post', `/client/sessions/${sessionId}/agents`, { agent_type: 'claude-code', display_name: 'GF Agent' });
  expect(agent.status, 'add agent').toBe(200);
  const agentInstanceId = agent.body?.data?.id as string;

  const msg = await hubJson(web.page, 'post', `/client/sessions/${sessionId}/messages`, {
    content_type: 'text',
    content: JSON.stringify({ content: `${label}: please answer once.` }),
  });
  expect(msg.status, 'send trigger message').toBe(200);
  const triggerMessageId = (msg.body?.data?.message_id ?? msg.body?.data?.id) as string;
  expect(triggerMessageId, 'message id in send response').toBeTruthy();

  const task = await hubJson(web.page, 'post', '/web/agent-tasks', {
    trigger_message_id: triggerMessageId, agent_instance_id: agentInstanceId, target_id: edge.targetId,
  });
  expect(task.status, 'trigger task').toBe(200);
  const taskId = task.body?.data?.id as string;

  const runId = `gf-run-${crypto.randomBytes(6).toString('hex')}`;
  const agentReplyText = `${label}: final answer from the real Edge callback contract.`;
  for (const [path, payload] of [
    [`/edge/agent-tasks/${taskId}/ack`, { edge_run_id: runId }],
    [`/edge/agent-tasks/${taskId}/stream`, { edge_run_id: runId, event_type: 'output', content: `${label}: thinking...` }],
    [`/edge/agent-tasks/${taskId}/done`, { edge_run_id: runId, final_content: agentReplyText }],
  ] as Array<[string, unknown]>) {
    const res = await api.post(`${HUB}${path}`, { data: payload, headers: { Authorization: `Bearer ${edge.token}` } });
    expect(res.status(), `edge callback ${path.split('/').pop()}`).toBe(200);
  }
  return { sessionId, taskId, agentReplyText, sessionName };
}

/** 真浏览器 Account OIDC 登录（与 real-oidc-login.spec.ts 同一路径）。 */
async function loginInBrowser(page: Page, email: string, password: string): Promise<HubSession> {
  await page.goto(`${WEB}/workbench/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', {
    name: /Continue with TokenDance Account|使用 TokenDance Account 登录/i,
  }).first().click();
  const accountOrigin = new URL(ACCOUNT_ISSUER).origin;
  await expect.poll(() => {
    try {
      return new URL(page.url()).origin;
    } catch {
      return '';
    }
  }, { timeout: 25_000 }).toBe(accountOrigin);
  await page.locator('#login-email').fill(email);
  await page.getByRole('button', { name: /^(Next|下一步)$/i }).click();
  await page.locator('#login-secret').fill(password);
  await page.getByRole('button', { name: /^(Sign in|登录)$/i }).click();
  await page.getByRole('button', { name: /^(Allow access|允许访问)$/i }).click({ noWaitAfter: true });
  await page.waitForURL('**/workbench/**', { timeout: 30_000 });
  await expect.poll(async () => (await browserHubJson(page, 'get', '/client/auth/browser/session')).status).toBe(200);
  const me = await browserHubJson(page, 'get', '/client/auth/browser/session');
  const userId = String(me.body?.data?.user?.id ?? '');
  expect(userId).toBeTruthy();
  return { page, userId };
}

async function seedSessionInPage(page: Page): Promise<void> {
  await page.goto(`${WEB}/workbench/`, { waitUntil: 'domcontentloaded' });
}

async function openSessionByName(page: Page, name: string): Promise<void> {
  const row = page.getByRole('button', { name, exact: true });
  await row.click({ timeout: 25_000 });
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
  const item = page.locator('[role="menuitem"]', { hasText: /Regenerate|重新生成/ }).first();
  if (!(await item.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false))) {
    await page.keyboard.press('Escape');
    return false;
  }
  await item.click();
  return true;
}

test.describe('AgentHub Golden Flows（真实栈）', () => {
  // 串行：四条流共享同一组真实 Hub 会话与 Account 登录结果。
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  let sharedApi: APIRequestContext;
  let webSession: HubSession;
  let edgeSession: EdgeSession;
  let webContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    if (!ACCOUNT_ISSUER || !USER_EMAIL || !USER_PASSWORD) {
      test.skip(true, 'external Account and disposable test credentials are required');
      return;
    }
    sharedApi = await pwRequest.newContext();
    webContext = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 810 } });
    const webPage = await webContext.newPage();
    webSession = await loginInBrowser(webPage, USER_EMAIL, USER_PASSWORD);
    edgeSession = { token: EDGE_TOKEN, targetId: EDGE_TARGET_ID };
  });

  test.afterAll(async () => {
    try {
      for (const id of createdSessionIds) {
        const result = await browserHubJson(webSession.page, 'delete', `/client/sessions/${encodeURIComponent(id)}`);
        expect(result.status, 'delete only the conversation created by this Golden run').toBe(200);
      }
    } finally {
      createdSessionIds.clear();
      await webContext?.close();
      await sharedApi?.dispose();
    }
  });

  test('GF1 真登录后主界面拿到真实 Hub 数据（会话与消息非 demo）', async () => {
    test.skip(!EDGE_TOKEN || !EDGE_TARGET_ID, 'Golden callback checks require a provisioned native Edge token and matching target id; browser cookies cannot impersonate Edge.');
    const prov = await provisionConversation(sharedApi, webSession, edgeSession, 'GF1');

    const page = await webContext.newPage();
    await seedSessionInPage(page);
    await openSessionByName(page, prov.sessionName);
    // 真数据断言：用户消息与 agent 回复都来自 Hub（文本逐字匹配 provisioning 内容）。
    await expect(page.getByText(prov.agentReplyText).first()).toBeVisible({ timeout: 20_000 });
    await page.close();
  });

  test('GF2 「重新生成」发真 task id 且成功（#2274 回归门）', async () => {
    test.skip(!EDGE_TOKEN || !EDGE_TARGET_ID, 'Golden callback checks require a provisioned native Edge token and matching target id; browser cookies cannot impersonate Edge.');
    const prov = await provisionConversation(sharedApi, webSession, edgeSession, 'GF2');

    const page = await webContext.newPage();
    const regenerateCalls: Array<{ url: string; status: number }> = [];
    page.on('response', (res) => {
      if (res.url().includes('/regenerate')) regenerateCalls.push({ url: res.url(), status: res.status() });
    });
    await seedSessionInPage(page);
    await openSessionByName(page, prov.sessionName);
    const block = page.locator('[data-block-id^="hub-message-"]', { hasText: prov.agentReplyText }).first();
    await expect(block).toBeVisible({ timeout: 20_000 });

    const offered = await clickRegenerate(page, page.locator('[data-block-id^="hub-message-"]').filter({ hasText: prov.agentReplyText }));
    expect(offered, 'regenerate entry offered for a stamped agent reply').toBe(true);

    await expect.poll(() => regenerateCalls.length, { timeout: 15_000 }).toBeGreaterThan(0);
    // 身份合同：URL 里必须是**任务 id**，且请求成功。
    expect(regenerateCalls[0]!.url).toContain(`/web/agent-tasks/${prov.taskId}/regenerate`);
    expect(regenerateCalls[0]!.status).toBe(200);
    await expect(page.getByText(/Regenerating|重新生成中/i).first()).toBeVisible({ timeout: 10_000 });
    await page.close();
  });

  test('GF3 未登录时只显示登录入口，不暴露会话或「重新生成」', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, locale: 'en-US' });
    const page = await context.newPage();
    const regenerateCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/regenerate')) regenerateCalls.push(req.url());
    });
    await page.goto(`${WEB}/workbench/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /Continue with TokenDance Account|使用 TokenDance Account 登录/i })).toBeVisible();
    expect((await browserHubJson(page, 'get', '/client/auth/browser/session')).status).toBe(401);
    await expect(page.getByTestId('agenthub-workbench')).toHaveCount(0);
    expect(regenerateCalls).toEqual([]);
    await context.close();
  });

  test('GF4 Edge 回调落地后 transcript 无需手动刷新（invalidation 回归门）', async () => {
    test.skip(!EDGE_TOKEN || !EDGE_TARGET_ID, 'Golden callback checks require a provisioned native Edge token and matching target id; browser cookies cannot impersonate Edge.');
    const prov = await provisionConversation(sharedApi, webSession, edgeSession, 'GF4');

    const page = await webContext.newPage();
    await seedSessionInPage(page);
    await openSessionByName(page, prov.sessionName);
    await expect(page.getByText(prov.agentReplyText).first()).toBeVisible({ timeout: 20_000 });

    // 页面保持打开：再触发一个任务并走真实回调，新 agent 消息必须自己出现。
    const msg2 = await hubJson(webSession.page, 'post', `/client/sessions/${prov.sessionId}/messages`, {
      content_type: 'text',
      content: JSON.stringify({ content: 'GF4: second question, answer again.' }),
    });
    expect(msg2.status).toBe(200);
    const task2 = await hubJson(webSession.page, 'post', '/web/agent-tasks', {
      trigger_message_id: msg2.body?.data?.message_id,
      agent_instance_id: (await hubJson(webSession.page, 'post', `/client/sessions/${prov.sessionId}/agents`, { agent_type: 'claude-code', display_name: 'GF Agent 2' })).body?.data?.id,
      target_id: edgeSession.targetId,
    });
    expect(task2.status).toBe(200);
    const taskId2 = task2.body?.data?.id as string;
    const runId2 = `gf-run2-${crypto.randomBytes(6).toString('hex')}`;
    const secondReply = 'GF4: second answer arrived without a manual reload.';
    for (const [path, payload] of [
      [`/edge/agent-tasks/${taskId2}/ack`, { edge_run_id: runId2 }],
      [`/edge/agent-tasks/${taskId2}/done`, { edge_run_id: runId2, final_content: secondReply }],
    ] as Array<[string, unknown]>) {
      const res = await sharedApi.post(`${HUB}${path}`, { data: payload, headers: { Authorization: `Bearer ${edgeSession.token}` } });
      expect(res.status(), `edge callback ${path.split('/').pop()}`).toBe(200);
    }
    // 无 reload、无手动 refetch：WS/invalidation 必须把新消息带进 DOM。
    await expect(page.getByText(secondReply).first()).toBeVisible({ timeout: 30_000 });
    await page.close();
  });
});
