/**
 * Visual QA — Web Chat path capture (gate half, #1940)
 * Viewport 1440x810 · themes light+dark · fully stubbed Hub · Chat main path
 *
 * Merge-gate companion of visual-qa-shell.mjs: captures the chat content
 * surface (transcript + composer + inspector) and emits a DOM/geometry
 * contract JSON next to each PNG. The assert step
 * (scripts/assert-visual-qa-chat.mjs) fails closed on missing shots or a
 * broken contract. No pixel goldens.
 *
 * Transcript source: the proven stubbed-Hub replay pattern of
 * app/web/src/__e2e__/chat-flow-contract.spec.ts (#1839) — approved-real
 * data mode + a finished agent task whose replay events render one tool
 * card pair and one markdown text block with a fenced code block. Task
 * status 'done' pins the STREAMING-ENDED state: replay hydrated, composer
 * on Send (not Stop), no typing indicator.
 *
 * Usage (from app/web):
 *   node scripts/visual-qa-chat.mjs
 *   pnpm --filter agenthub-web visual:qa:chat
 * Env: VISUAL_QA_DPR · AGENTHUB_WEB_E2E_PORT · WEB_QA_URL / AGENTHUB_WEB_QA_URL
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'screenshots', 'visual-qa');
const port = Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5174);
const baseUrl =
  process.env.AGENTHUB_WEB_QA_URL ??
  process.env.WEB_QA_URL ??
  `http://127.0.0.1:${port}/`;
const viewport = { width: 1440, height: 810 };
const dpr = Math.max(1, Number(process.env.VISUAL_QA_DPR ?? 1) || 1);
const dprSuffix = dpr === 1 ? '' : `@${dpr}x`;
const themes = ['light', 'dark'];
const THEME_KEY_V4 = 'agenthub-v4-theme';
const THEME_KEY_LEGACY = 'agenthub-theme';
const WORKBENCH_SHELL = '[data-testid="agenthub-workbench"]';
// Locale-stable rail selector: aria-labels resolve through chatview i18n,
// so target the data-rail-page hook instead (#1826).
const CHAT_RAIL_BUTTON = 'button[data-rail-page="chat"]';
const TRANSCRIPT_LOG = '[role="log"]';
const SESSION_ID = 'session_web_chat';
const TASK_ID = 'task_web_chat_qa';
// UX F8 goal scene (#1998): a second conversation whose replay carries real
// create_goal tool events, proving the goal banner projection end-to-end.
const GOAL_SESSION_ID = 'session_web_goal';
const GOAL_TASK_ID = 'task_web_goal_qa';
const GOAL_CALL_ID = 'vqa-goal-create';
const GOAL_OBJECTIVE = 'Migrate every endpoint to the single typed API client';
// callId is ours to choose — stableInteractionId renders `call-<toolCallId>`
// as the tool card data-block-id (chatview stable DOM identity).
const TOOL_CALL_ID = 'vqa-read';
const hubUrlPattern =
  /https?:\/\/(?:localhost:8080|127\.0\.0\.1:8080|hub\.vectorcontrol\.tech|api\.hub\.vectorcontrol\.tech)\/.*/;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url, timeoutMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok || res.status === 404) return;
    } catch {
      /* retry */
    }
    await wait(400);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function hubEnvelope(data) {
  return { code: 'ok', data };
}

function json(data) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(data),
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    },
  };
}

/**
 * Replay events for the finished task: one tool_call/tool_result card pair
 * plus one markdown text block carrying a fenced code block. Shapes mirror
 * chat-flow-contract.spec.ts chatFlowEvents (proven against the shared
 * transcript normalize pipeline).
 */
function chatVisualQaEvents() {
  return [
    {
      id: 'evt-vqa-tool-call',
      task_id: TASK_ID,
      edge_run_id: 'run-web-chat-qa',
      session_id: SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 1,
      event_type: 'run.agent.tool_call',
      payload: { callId: TOOL_CALL_ID, toolName: 'Read', path: 'src/shared/chatview/adapter.ts' },
      created_at: '2026-06-26T08:00:01Z',
    },
    {
      id: 'evt-vqa-tool-result',
      task_id: TASK_ID,
      edge_run_id: 'run-web-chat-qa',
      session_id: SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 2,
      event_type: 'run.agent.tool_result',
      payload: { callId: TOOL_CALL_ID, toolName: 'Read', summary: 'adapter.ts · 412 lines · transcript normalize pipeline verified' },
      created_at: '2026-06-26T08:00:02Z',
    },
    {
      id: 'evt-vqa-text-block',
      task_id: TASK_ID,
      edge_run_id: 'run-web-chat-qa',
      session_id: SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 3,
      event_type: 'run.agent.text_block',
      payload: {
        // Fenced block exercises the Markdown → CodeBlock render path in
        // BOTH themes; the table keeps a second markdown structure alive.
        content: [
          '视觉合同捕获完成，回放已结束。代码块合同如下：',
          '',
          '```ts',
          'export function visualQaChatContract(): string {',
          "  return 'non-blank + geometry, no pixel golden';",
          '}',
          '```',
          '',
          '| 合同项 | 状态 |',
          '| --- | --- |',
          '| code block | rendered |',
          '| tool card | completed |',
        ].join('\n'),
      },
      created_at: '2026-06-26T08:00:03Z',
    },
  ];
}

function goalVisualQaEvents() {
  return [
    {
      id: 'evt-vqa-goal-call',
      task_id: GOAL_TASK_ID,
      edge_run_id: 'run-web-goal-qa',
      session_id: GOAL_SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 1,
      event_type: 'run.agent.tool_call',
      payload: {
        callId: GOAL_CALL_ID,
        toolName: 'create_goal',
        status: 'completed',
        input: { objective: GOAL_OBJECTIVE },
      },
      created_at: '2026-08-28T02:00:01Z',
    },
    {
      id: 'evt-vqa-goal-result',
      task_id: GOAL_TASK_ID,
      edge_run_id: 'run-web-goal-qa',
      session_id: GOAL_SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 2,
      event_type: 'run.agent.tool_result',
      payload: { callId: GOAL_CALL_ID, toolName: 'create_goal', summary: 'Goal registered' },
      created_at: '2026-08-28T02:00:02Z',
    },
    {
      id: 'evt-vqa-goal-text',
      task_id: GOAL_TASK_ID,
      edge_run_id: 'run-web-goal-qa',
      session_id: GOAL_SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 3,
      event_type: 'run.agent.text_block',
      payload: { content: '目标已登记，开始长程迁移。' },
      created_at: '2026-08-28T02:00:03Z',
    },
  ];
}

async function installMockHub(context, scene = 'main') {
  // Scene switch: 'main' keeps the historic gate fixture untouched; 'goal'
  // serves a single goal conversation so the capture lands on it directly.
  const isGoal = scene === 'goal';
  const sessionId = isGoal ? GOAL_SESSION_ID : SESSION_ID;
  const taskId = isGoal ? GOAL_TASK_ID : TASK_ID;
  const sessionName = isGoal ? 'Goal visual QA' : 'Chat visual QA';
  const userMessageText = isGoal
    ? '启动长程目标会话：登记迁移目标。'
    : '启动聊天内容面的视觉合同捕获。';
  const replayEvents = isGoal ? goalVisualQaEvents() : chatVisualQaEvents();

  await context.route(hubUrlPattern, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: json({}).headers });
    }
    if (pathname.endsWith('/health')) {
      return route.fulfill(
        json({ status: 'ok', version: 'web-visual-qa-chat', uptime: '1h', checks: {} }),
      );
    }
    if (pathname === '/client/auth/me') {
      return route.fulfill(
        json(
          hubEnvelope({
            id: 'user_visual',
            username: 'visual-reviewer',
            nickname: 'Visual Reviewer',
            avatar_url: '',
          }),
        ),
      );
    }
    if (pathname === '/client/sessions') {
      return route.fulfill(
        json(
          hubEnvelope([
            {
              id: sessionId,
              type: 'group',
              name: sessionName,
              member_count: 2,
              unread_count: 0,
            },
          ]),
        ),
      );
    }
    if (pathname === `/client/sessions/${sessionId}/messages`) {
      return route.fulfill(
        json(
          hubEnvelope([
            {
              id: 'message-vqa-user',
              session_id: sessionId,
              seq_id: 1,
              client_msg_id: 'client-vqa-user',
              sender_type: 'user',
              sender_id: 'user_visual',
              sender: { nickname: 'Visual Reviewer' },
              content_type: 'text',
              content: userMessageText,
              created_at: '2026-06-26T08:00:00Z',
            },
          ]),
        ),
      );
    }
    if (pathname === `/client/sessions/${sessionId}/pins`) {
      return route.fulfill(json(hubEnvelope([])));
    }
    if (pathname === '/client/contacts' || pathname === '/client/notifications') {
      return route.fulfill(json(hubEnvelope([])));
    }
    if (pathname === '/web/agent-profiles' || pathname === '/web/projects') {
      return route.fulfill(json(hubEnvelope({ items: [], page: { hasMore: false } })));
    }
    if (pathname === '/web/execution-targets') {
      return route.fulfill(
        json(
          hubEnvelope({
            items: [
              {
                id: 'target-vqa',
                name: 'Chat QA Desktop Edge',
                target_type: 'local_edge',
                workspace_allowlist: [],
                trust_level: 'local',
                health_state: 'healthy',
                is_online: true,
              },
            ],
            page: { hasMore: false },
          }),
        ),
      );
    }
    if (pathname === `/web/agent-tasks/${taskId}/events`) {
      return route.fulfill(json(hubEnvelope(replayEvents)));
    }
    if (pathname === `/web/agent-tasks/${taskId}/events/summary`) {
      // status 'done' = streaming-ENDED: replay stays hydrated while the
      // composer keeps the Send control (chat-flow-contract.spec.ts).
      return route.fulfill(
        json(
          hubEnvelope({
            task_id: taskId,
            edge_run_id: isGoal ? 'run-web-goal-qa' : 'run-web-chat-qa',
            status: 'done',
            total_events: replayEvents.length,
            last_event_seq: replayEvents.length,
            event_type_counts: {},
            tool_call_count: 1,
            step_count: 1,
            artifact_count: 0,
            approval_count: 0,
            pending_approvals: 0,
            decided_approvals: 0,
            input_tokens: 0,
            output_tokens: 0,
            output_bytes: 0,
          }),
        ),
      );
    }
    if (pathname === `/web/agent-tasks/${taskId}/approvals`) {
      return route.fulfill(
        json(
          hubEnvelope({
            task_id: taskId,
            edge_run_id: isGoal ? 'run-web-goal-qa' : 'run-web-chat-qa',
            session_id: sessionId,
            approvals: [],
            pending: [],
            decided: [],
            last_event_seq: replayEvents.length,
          }),
        ),
      );
    }
    if (pathname === `/web/agent-tasks/${taskId}/artifacts`) {
      return route.fulfill(
        json(
          hubEnvelope({
            task_id: taskId,
            edge_run_id: isGoal ? 'run-web-goal-qa' : 'run-web-chat-qa',
            session_id: sessionId,
            artifacts: [],
            last_event_seq: replayEvents.length,
          }),
        ),
      );
    }
    return route.fulfill(json(hubEnvelope({})));
  });
}

async function maybeStartDevServer() {
  if (process.env.AGENTHUB_WEB_QA_URL || process.env.WEB_QA_URL) {
    return { stop: async () => {} };
  }
  const child = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['dev', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: projectRoot,
      stdio: 'ignore',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        // Match visual-qa-shell.mjs: mount at the origin root and pin the
        // hub URL so every Hub call lands in the Playwright route stub.
        VITE_BASE_PATH: '/',
        VITE_HUB_URL: 'http://localhost:8080',
      },
    },
  );
  await waitForUrl(baseUrl);
  return {
    stop: async () => {
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}

async function captureTheme(browser, theme, scene, vp = { width: 1440, height: 810, label: '1440x810' }) {
  const isGoal = scene === 'goal';
  const shotBase = isGoal ? `web-chat-goal-${theme}-${vp.label}` : `web-chat-${theme}-${vp.label}`;
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: dpr,
    serviceWorkers: 'block',
    colorScheme: theme,
  });
  await installMockHub(context, scene);
  const page = await context.newPage();

  // Storage before navigation: theme (v4 SSOT + legacy), locale, hub auth,
  // approved-real data mode and the finished active task (replay source).
  await page.addInitScript(
    ({ v4Key, legacyKey, theme: t, sessionId, taskId }) => {
      window.localStorage.setItem(v4Key, t);
      window.localStorage.setItem(legacyKey, t);
      window.localStorage.setItem('agenthub-language', 'zh');
      window.localStorage.setItem('agenthub_hub_url', 'http://localhost:8080');
      window.localStorage.setItem('agenthub.workbench.dataMode', 'approved-real');
      window.localStorage.setItem(
        `agenthub.web.activeAgentTask.${sessionId}`,
        JSON.stringify({ taskId, sessionId, status: 'done' }),
      );
      window.sessionStorage.setItem('agenthub_hub_token', 'visual-qa-token');
      window.sessionStorage.setItem('agenthub_token_source', 'hub');
      window.sessionStorage.setItem(
        'agenthub_hub_user',
        JSON.stringify({ userId: 'user_visual', username: 'visual-reviewer' }),
      );
    },
    {
      v4Key: THEME_KEY_V4,
      legacyKey: THEME_KEY_LEGACY,
      theme,
      sessionId: isGoal ? GOAL_SESSION_ID : SESSION_ID,
      taskId: isGoal ? GOAL_TASK_ID : TASK_ID,
    },
  );

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  try {
    await page.waitForSelector(WORKBENCH_SHELL, { state: 'visible', timeout: 30_000 });
  } catch {
    const diagFile = path.join(outDir, `${shotBase}${dprSuffix}-DIAGNOSTIC.png`);
    await page.screenshot({ path: diagFile, fullPage: false });
    throw new Error(`Workbench shell not visible for chat theme=${theme} scene=${scene}. Diagnostic: ${diagFile}`);
  }

  // Prefer the Chat rail so capture shows transcript + composer + inspector.
  try {
    const chatRail = page.locator(CHAT_RAIL_BUTTON).first();
    if (await chatRail.isVisible().catch(() => false)) {
      await chatRail.click();
    }
  } catch {
    /* the single-session stub may already land on chat */
  }

  // Fail closed with a diagnostic if the scene content does not materialize
  // — the assert step trusts only captures that reached this contract.
  try {
    await page.waitForSelector(TRANSCRIPT_LOG, { state: 'visible', timeout: 20_000 });
    if (isGoal) {
      // Goal scene (#1998): the banner is the contract content. It renders
      // above the transcript, projected from the replayed create_goal call.
      await page.waitForSelector('section[data-goal-status]', { state: 'visible', timeout: 20_000 });
    } else {
      await page.waitForFunction(
        ({ callId }) => {
          const log = document.querySelector('[role="log"]');
          if (!log) return false;
          const copyBtn = Array.from(log.querySelectorAll('button')).find((b) =>
            /^(复制|Copy)$/.test((b.getAttribute('aria-label') || '').trim()),
          );
          const card = log.querySelector(`[data-block-id="call-${callId}"]`);
          return Boolean(copyBtn) && Boolean(card);
        },
        { callId: TOOL_CALL_ID },
        { timeout: 20_000 },
      );
    }
  } catch {
    const diagFile = path.join(outDir, `${shotBase}${dprSuffix}-CONTENT-DIAGNOSTIC.png`);
    await page.screenshot({ path: diagFile, fullPage: false });
    const bodyText = await page.evaluate(() => (document.body?.innerText ?? '(no body)').slice(0, 300));
    throw new Error(
      `Chat contract content not rendered for theme=${theme} scene=${scene}. ` +
        `Body: ${bodyText.slice(0, 200)}. Diagnostic: ${diagFile}`,
    );
  }

  // Re-apply theme attributes after React hydration to guarantee correctness.
  await page.evaluate(
    ({ v4Key, legacyKey, theme: t }) => {
      window.localStorage.setItem(v4Key, t);
      window.localStorage.setItem(legacyKey, t);
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.style.colorScheme = t;
    },
    { v4Key: THEME_KEY_V4, legacyKey: THEME_KEY_LEGACY, theme },
  );

  // Settle for CSS transitions, fonts, and the lazy syntax-highlighter chunk.
  await wait(800);

  const file = path.join(outDir, `${shotBase}${dprSuffix}.png`);
  await page.screenshot({ path: file, fullPage: false });

  // DOM/geometry contract (no pixel goldens): proves the capture hit the chat
  // content surface with a code block message and a completed tool card, in
  // the streaming-ended state, without horizontal overflow.
  const contract = await page.evaluate((callId) => {
    const measure = (el) => {
      if (!el) return { exists: false };
      const rect = el.getBoundingClientRect();
      return { exists: true, width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const log = document.querySelector('[role="log"]');
    // CodeBlock header copy button (aria-label 复制/Copy) is the locale-stable
    // hook for fenced blocks; the wrapper is the header's parent.
    const copyBtn = log
      ? Array.from(log.querySelectorAll('button')).find((b) =>
          /^(复制|Copy)$/.test((b.getAttribute('aria-label') || '').trim()),
        )
      : null;
    const codeBlockWrapper = copyBtn ? copyBtn.closest('div')?.parentElement : null;
    const toolCard = log ? log.querySelector(`[data-block-id="call-${callId}"]`) : null;
    const buttons = Array.from(document.querySelectorAll('button'));
    const named = (re) =>
      buttons.some((b) => re.test(b.textContent || '') || re.test(b.getAttribute('aria-label') || ''));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      appliedTheme: document.documentElement.getAttribute('data-theme'),
      dataMode:
        document.querySelector('[data-testid="agenthub-workbench"]')?.getAttribute('data-data-mode') ?? '',
      workbenchShell: Boolean(document.querySelector('[data-testid="agenthub-workbench"]')),
      chatLog: measure(log),
      userMessage: { count: log ? log.querySelectorAll('.user-bubble').length : 0 },
      codeBlock: measure(codeBlockWrapper),
      toolCard: measure(toolCard),
      streamingEnded: {
        typingIndicator: Boolean(document.querySelector('.typingIndicator')),
        sendVisible: named(/^(?:Send message|发送消息)$/),
        stopVisible: named(/^(?:Stop|停止)/),
      },
      composer: measure(document.querySelector('textarea')),
      // UX F8 (#1998): goal banner geometry — exists only in the goal scene.
      goalBanner: measure(document.querySelector('section[data-goal-status]')),
      goalStatus: document.querySelector('section[data-goal-status]')?.getAttribute('data-goal-status') ?? '',
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  }, TOOL_CALL_ID);
  const contractFile = path.join(outDir, `${shotBase}${dprSuffix}.json`);
  await writeFile(contractFile, JSON.stringify(contract, null, 2) + '\n');

  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await context.close();
  return { file, contractFile, contract, applied, theme, scene };
}

// #1998 goal scene viewports: the 1440x810 gate tier plus the 768x900
// narrow responsive tier (supplementary evidence, same overflow contract).
const GOAL_VIEWPORTS = [
  { width: 1440, height: 810, label: '1440x810' },
  { width: 768, height: 900, label: '768x900' },
];

async function main() {
  await mkdir(outDir, { recursive: true });
  // Remove expected outputs before capture so a failed run cannot pass the
  // assert step on stale files from an older run (same policy as the shell gate).
  for (const theme of themes) {
    await rm(path.join(outDir, `web-chat-${theme}-1440x810${dprSuffix}.png`), { force: true });
    await rm(path.join(outDir, `web-chat-${theme}-1440x810${dprSuffix}.json`), { force: true });
    for (const vp of GOAL_VIEWPORTS) {
      await rm(path.join(outDir, `web-chat-goal-${theme}-${vp.label}${dprSuffix}.png`), { force: true });
      await rm(path.join(outDir, `web-chat-goal-${theme}-${vp.label}${dprSuffix}.json`), { force: true });
    }
  }
  const server = await maybeStartDevServer();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const theme of themes) {
      results.push(await captureTheme(browser, theme, 'main'));
    }
    // UX F8 goal scene (#1998): real replayed create_goal events projected
    // into the conversation goal banner, gate + narrow tiers.
    for (const vp of GOAL_VIEWPORTS) {
      for (const theme of themes) {
        results.push(await captureTheme(browser, theme, 'goal', vp));
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }

  for (const r of results) {
    if (r.applied !== r.theme) {
      console.warn(`warn: expected data-theme=${r.theme}, got ${r.applied}`);
    }
    console.log(`wrote ${r.file}`);
    console.log(
      `contract ${r.contractFile} codeBlock=${r.contract.codeBlock.exists} toolCard=${r.contract.toolCard.exists} overflow=${r.contract.horizontalOverflow}`,
    );
  }
  console.log(`Web visual-qa chat capture done (${results.length} shots) → ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
