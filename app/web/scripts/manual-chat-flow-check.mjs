import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.AGENTHUB_WEB_MANUAL_PORT ?? 5202);
const ownsServer = !process.env.AGENTHUB_WEB_MANUAL_URL;
const baseURL = process.env.AGENTHUB_WEB_MANUAL_URL ?? `http://127.0.0.1:${port}`;
const hubOrigin = 'http://localhost:8080';
const outputDir = path.resolve(process.cwd(), '.tmp', 'manual-chat-flow-uiux');
const screenshot = path.join(outputDir, 'web-1440x810-chat-flow.png');
const sessionId = 'session-web-manual-chat-flow';
const taskId = 'task-web-manual-chat-flow';

fs.mkdirSync(outputDir, { recursive: true });

const blockedHosts = new Set([
  'api.hub.vectorcontrol.tech',
  'hub.vectorcontrol.tech',
  'id.vectorcontrol.tech',
  'api.vectorcontrol.tech',
  'localhost:3210',
  '127.0.0.1:3210',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForURL(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'no response'}`);
}

function startDevServer() {
  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'corepack';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `corepack.cmd pnpm dev --host 127.0.0.1 --port ${port}`]
    : ['pnpm', 'dev', '--host', '127.0.0.1', '--port', String(port)];
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER: 'none' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
  return child;
}

function stopDevServer(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

function hubEnvelope(data) {
  return { code: 'ok', data };
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  };
}

function json(body) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
    headers: corsHeaders(),
  };
}

function chatFlowEvents() {
  return [
    {
      id: 'evt-manual-call-read-a',
      task_id: taskId,
      edge_run_id: 'run-web-manual-chat-flow',
      session_id: sessionId,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 1,
      event_type: 'run.agent.tool_call',
      payload: { callId: 'manual-read-a', toolName: 'Read', path: 'src/a.ts' },
      created_at: '2026-06-26T09:00:01Z',
    },
    {
      id: 'evt-manual-result-read-a',
      task_id: taskId,
      edge_run_id: 'run-web-manual-chat-flow',
      session_id: sessionId,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 2,
      event_type: 'run.agent.tool_result',
      payload: { callId: 'manual-read-a', toolName: 'Read', summary: 'Manual visual result belongs to src/a.ts' },
      created_at: '2026-06-26T09:00:02Z',
    },
    {
      id: 'evt-manual-subtask-report',
      task_id: taskId,
      edge_run_id: 'run-web-manual-chat-flow',
      session_id: sessionId,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 3,
      event_type: 'run.agent.subagent_task',
      payload: {
        title: 'Manual deep report should stay in inspector',
        worker: 'Visual Reviewer',
        status: 'running',
        summary: 'Inspector-only detail for manual visual check.',
      },
      created_at: '2026-06-26T09:00:03Z',
    },
    {
      id: 'evt-manual-markdown-summary',
      task_id: taskId,
      edge_run_id: 'run-web-manual-chat-flow',
      session_id: sessionId,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 4,
      event_type: 'run.agent.text_block',
      payload: {
        content: [
          'Manual Web visual replay summary.',
          '',
          '| Check | Status |',
          '| --- | --- |',
          '| order | ordered |',
          '| markdown | rendered |',
        ].join('\n'),
      },
      created_at: '2026-06-26T09:00:04Z',
    },
  ];
}

async function fulfillHubRoute(route, pathname) {
  if (pathname === '/client/auth/me') {
    await route.fulfill(json(hubEnvelope({
      id: 'user-web-manual',
      username: 'web-manual',
      nickname: 'Web Manual',
      avatar_url: '',
    })));
    return;
  }

  if (pathname === '/client/sessions') {
    await route.fulfill(json(hubEnvelope([{
      id: sessionId,
      type: 'group',
      name: 'Web visual chat flow',
      member_count: 2,
      unread_count: 0,
    }])));
    return;
  }

  if (pathname === `/client/sessions/${sessionId}/messages`) {
    await route.fulfill(json(hubEnvelope([{
      id: 'message-web-manual-user',
      session_id: sessionId,
      seq_id: 1,
      client_msg_id: 'client-web-manual-user',
      sender_type: 'user',
      sender_id: 'user-web-manual',
      sender: { nickname: 'Web Manual' },
      content_type: 'text',
      content: 'Kick off the manual Web visual chat flow.',
      created_at: '2026-06-26T09:00:00Z',
    }])));
    return;
  }

  if (
    pathname === `/client/sessions/${sessionId}/pins` ||
    pathname === '/client/contacts' ||
    pathname === '/client/notifications'
  ) {
    await route.fulfill(json(hubEnvelope([])));
    return;
  }

  if (pathname === '/web/agent-profiles' || pathname === '/web/projects') {
    await route.fulfill(json(hubEnvelope({ items: [], page: { hasMore: false } })));
    return;
  }

  if (pathname === '/web/execution-targets') {
    await route.fulfill(json(hubEnvelope({
      items: [{
        id: 'target-web-manual',
        name: 'Manual Web Desktop Edge',
        target_type: 'local_edge',
        workspace_allowlist: [],
        trust_level: 'local',
        health_state: 'healthy',
        is_online: true,
      }],
      page: { hasMore: false },
    })));
    return;
  }

  if (pathname === `/web/agent-tasks/${taskId}/events`) {
    await route.fulfill(json(hubEnvelope(chatFlowEvents())));
    return;
  }

  if (pathname === `/web/agent-tasks/${taskId}/summary`) {
    await route.fulfill(json(hubEnvelope({
      task_id: taskId,
      edge_run_id: 'run-web-manual-chat-flow',
      status: 'running',
      total_events: chatFlowEvents().length,
      last_event_seq: chatFlowEvents().length,
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
    })));
    return;
  }

  if (pathname === `/web/agent-tasks/${taskId}/approvals`) {
    await route.fulfill(json(hubEnvelope({
      task_id: taskId,
      edge_run_id: 'run-web-manual-chat-flow',
      session_id: sessionId,
      approvals: [],
      pending: [],
      decided: [],
      last_event_seq: chatFlowEvents().length,
    })));
    return;
  }

  if (pathname === `/web/agent-tasks/${taskId}/artifacts`) {
    await route.fulfill(json(hubEnvelope({
      task_id: taskId,
      edge_run_id: 'run-web-manual-chat-flow',
      session_id: sessionId,
      artifacts: [],
      last_event_seq: chatFlowEvents().length,
    })));
    return;
  }

  await route.fulfill(json(hubEnvelope({})));
}

function assertMetrics(result) {
  const failures = [];
  if (!result.headingVisible) failures.push('expected Web visual chat flow heading');
  if (result.tableCount < 1) failures.push('expected markdown table to render in transcript');
  if (result.horizontalOverflow > 1) failures.push(`expected no horizontal overflow, got ${result.horizontalOverflow}px`);
  if (result.scrollGap === null || result.scrollGap > 4) failures.push(`expected transcript auto-follow gap <= 4px, got ${result.scrollGap}`);
  if (result.userIndex < 0 || result.resultIndex <= result.userIndex || result.replyIndex <= result.resultIndex) {
    failures.push('expected user, tool result, and agent reply to remain in chronological order');
  }
  if (result.transcriptHasInspectorOnlyText) failures.push('expected subagent report details to stay out of main transcript');
  if (!result.inspectorHasReviewer) failures.push('expected inspector to show subagent evidence');
  if (result.transcriptHasModeDebug) failures.push('expected data-mode/debug status outside main transcript');
  if (failures.length > 0) {
    throw new Error(`Manual Web chat-flow UIUX check failed:\n- ${failures.join('\n- ')}`);
  }
}

let server = null;
let browser = null;

try {
  if (ownsServer) {
    try {
      await waitForURL(baseURL, 1_500);
      console.log(`[manual-web-chat-flow] Reusing existing Web server at ${baseURL}`);
    } catch {
      server = startDevServer();
      await waitForURL(baseURL);
    }
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const text = message.text();
      if (
        !text.includes("The Content Security Policy directive 'frame-ancestors' is ignored") &&
        !text.includes("WebSocket connection to 'ws://localhost:8080/client/ws") &&
        !text.includes('net::ERR_BLOCKED_BY_CLIENT.Inspector')
      ) {
        console.log(`[browser:${message.type()}] ${text}`);
      }
    }
  });
  page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === baseURL) {
      await route.continue();
      return;
    }
    if (url.origin === hubOrigin) {
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders() });
        return;
      }
      await fulfillHubRoute(route, url.pathname);
      return;
    }
    if (blockedHosts.has(url.host)) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'blocked_by_manual_web_chat_flow_check' }),
      });
      return;
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  await page.addInitScript(({ sessionId, taskId }) => {
    window.localStorage.setItem('agenthub.workbench.dataMode', 'approved-real');
    window.localStorage.setItem(`agenthub.web.activeAgentTask.${sessionId}`, JSON.stringify({
      taskId,
      sessionId,
      status: 'running',
    }));
    window.sessionStorage.setItem('agenthub_hub_token', 'stubbed-web-manual-token');
    window.sessionStorage.setItem('agenthub_token_source', 'hub');
    window.sessionStorage.setItem('agenthub_hub_user', JSON.stringify({
      userId: 'user-web-manual',
      username: 'web-manual',
    }));
  }, { sessionId, taskId });

  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('agenthub-workbench').waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: 'Web visual chat flow' }).waitFor({ state: 'visible' });
  await page.getByRole('log').waitFor({ state: 'visible' });
  await page.getByText('Manual Web visual replay summary.').waitFor({ state: 'visible' });
  const manualToolCard = page.locator('[data-block-id="call-manual-read-a"]');
  await manualToolCard.waitFor({ state: 'visible' });
  await manualToolCard.locator('.row-hd').click();
  await page.getByText('Manual visual result belongs to src/a.ts').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshot, fullPage: true });

  const result = await page.evaluate(() => {
    const log = document.querySelector('[role="log"]');
    const transcript = log instanceof HTMLElement ? log : null;
    const inspector = document.querySelector('[aria-label="Right inspector"]');
    const transcriptText = transcript?.textContent ?? '';
    const inspectorText = inspector?.textContent ?? '';
    return {
      headingVisible: Boolean(Array.from(document.querySelectorAll('h1,h2')).find((node) =>
        node.textContent?.includes('Web visual chat flow'),
      )),
      tableCount: transcript?.querySelectorAll('table').length ?? 0,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      scrollGap: transcript
        ? Math.max(0, transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight)
        : null,
      userIndex: transcriptText.indexOf('Kick off the manual Web visual chat flow.'),
      resultIndex: transcriptText.indexOf('Manual visual result belongs to src/a.ts'),
      replyIndex: transcriptText.indexOf('Manual Web visual replay summary.'),
      transcriptHasInspectorOnlyText: transcriptText.includes('Manual deep report should stay in inspector') ||
        transcriptText.includes('Visual Reviewer'),
      inspectorHasReviewer: inspectorText.includes('Visual Reviewer'),
      transcriptHasModeDebug: transcriptText.includes('Data:') ||
        transcriptText.includes('Hub replay:') ||
        transcriptText.includes('mock (auto fallback)'),
    };
  });

  const report = {
    baseURL,
    viewport: page.viewportSize(),
    screenshot,
    dataSource: 'stubbed-hub-session',
    real_tested: false,
    ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  assertMetrics(result);
} finally {
  if (browser) await browser.close();
  stopDevServer(server);
}
