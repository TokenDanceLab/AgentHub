import { expect, test, type Page, type Route } from '@playwright/test';
import {
  assertE2EDataModeScenario,
  classifyE2ERequest,
  createE2EDataModeScenario,
  type E2EObservedRequest,
} from '../../../shared/src/testing/e2eDataModeContract';

// Must match playwright.config.ts webServer VITE_HUB_URL: the fail-closed
// reserved origin keeps every Hub call inside the route stub instead of
// reaching localhost or production.
const HUB_ORIGIN = 'https://hub.test.invalid';
const WEB_E2E_PORT = Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5174);
const WEB_E2E_APP_ORIGIN = `http://127.0.0.1:${WEB_E2E_PORT}`;
const SESSION_ID = 'session-chat-flow';
const TASK_ID = 'task-chat-flow';
const DESKTOP_WORKSPACE_VIEWPORT = { width: 1440, height: 810 };
const WEB_CHAT_FLOW_SCENARIO = createE2EDataModeScenario({
  name: 'web-chat-flow-contract',
  surface: 'web',
  dataMode: 'approved-real',
  dataSource: 'stubbed-hub-session',
  appOrigin: WEB_E2E_APP_ORIGIN,
  hubOrigin: HUB_ORIGIN,
  mockAdapterUsed: true,
});

interface BackendRequestLog {
  endpoints: Set<string>;
  requests: E2EObservedRequest[];
}

test.describe('Web shared chat flow contract', () => {
  test('renders Hub messages and runtime events as one ordered shared transcript', async ({ page }) => {
    collectPageDiagnostics(page);
    const backendRequests = await installChatFlowHubStub(page);
    await enterApprovedRealHubSession(page);
    expect(page.viewportSize()).toEqual(DESKTOP_WORKSPACE_VIEWPORT);

    const transcript = page.getByRole('log');
    const inspector = page.getByRole('complementary', { name: 'Right inspector' });

    await expect(page.getByRole('heading', { name: 'Chat flow contract' })).toBeVisible();
    await expect(page.getByTestId('agenthub-workbench')).toHaveAttribute('data-data-mode', 'approved-real');
    await expect(transcript).toContainText('Kick off the chat flow contract.');
    await expect(transcript).toContainText('The replay summary is below.');
    await expect(transcript.locator('table')).toContainText('Status');
    await expect(transcript.locator('table')).toContainText('ordered');
    await expectTranscriptWithoutModeDebug(transcript);

    await expect(transcript.locator('[data-block-id="call-read-a"]')).toBeVisible();
    await expect(transcript.locator('[data-block-id="call-read-b"]')).toBeVisible();
    await transcript.locator('[data-block-id="call-read-a"] .row-hd').click();
    await transcript.locator('[data-block-id="call-read-b"] .row-hd').click();
    await expect(transcript.locator('[data-block-id="call-read-a"]')).toContainText('A result belongs to src/a.ts');
    await expect(transcript.locator('[data-block-id="call-read-b"]')).toContainText('B result belongs to src/b.ts');

    await expect(transcript).not.toContainText('Deep report should stay in inspector');
    await expect(transcript).not.toContainText('Reviewer QA');
    await expect(inspector).toContainText('Reviewer QA');
    await expect(inspector).toContainText(/fanout\s*(?:->|→)\s*Reviewer QA/);

    const order = await transcript.evaluate((node) => {
      const text = node.textContent ?? '';
      return {
        user: text.indexOf('Kick off the chat flow contract.'),
        toolA: text.indexOf('A result belongs to src/a.ts'),
        toolB: text.indexOf('B result belongs to src/b.ts'),
        reply: text.indexOf('The replay summary is below.'),
      };
    });
    expect(order.user).toBeGreaterThanOrEqual(0);
    expect(order.toolA).toBeGreaterThan(order.user);
    expect(order.toolB).toBeGreaterThan(order.toolA);
    expect(order.reply).toBeGreaterThan(order.toolB);

    await expect.poll(() => backendRequests.endpoints.has(`GET /web/agent-tasks/${TASK_ID}/events`)).toBe(true);
    await expect.poll(() => backendRequests.endpoints.has(`GET /web/agent-tasks/${TASK_ID}/events/summary`)).toBe(true);
    await expect(page.getByText('mock (auto fallback)')).toHaveCount(0);
    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(1);
    assertE2EDataModeScenario(WEB_CHAT_FLOW_SCENARIO, backendRequests.requests);
  });

  test('keeps a submitted Hub user message visible while the send request is in flight', async ({ page }) => {
    collectPageDiagnostics(page);
    const backendRequests = await installChatFlowHubStub(page, { messagePostDelayMs: 800, taskStatus: 'done' });
    // A finished (not running) task keeps the replay transcript hydrated while
    // leaving the composer on the Send control — a running task switches the
    // composer to the Stop control and blocks plain message sends.
    await enterApprovedRealHubSession(page, { activeTaskStatus: 'done' });
    expect(page.viewportSize()).toEqual(DESKTOP_WORKSPACE_VIEWPORT);

    const transcript = page.getByRole('log');
    const submittedText = `Web optimistic send ${Date.now()}`;
    await installMessagePresenceProbe(page, submittedText);
    await submitComposerMessage(page, submittedText);

    await expect(transcript.locator('.user-bubble').filter({ hasText: submittedText })).toHaveCount(1);
    await expect.poll(() => backendRequests.endpoints.has(`POST /client/sessions/${SESSION_ID}/messages`)).toBe(true);
    await expect.poll(() => messagePresenceProbe(page)).toMatchObject({
      sawVisible: true,
      disappearedAfterVisible: false,
    });
    const order = await transcript.evaluate((node, text) => {
      const transcriptText = node.textContent ?? '';
      return {
        replaySummary: transcriptText.indexOf('The replay summary is below.'),
        submitted: transcriptText.indexOf(text),
      };
    }, submittedText);
    expect(order.replaySummary).toBeGreaterThanOrEqual(0);
    expect(order.submitted).toBeGreaterThan(order.replaySummary);
    await expect.poll(() => transcriptScrollGap(page)).toBeLessThanOrEqual(4);
    await expectTranscriptWithoutModeDebug(transcript);
    assertE2EDataModeScenario(WEB_CHAT_FLOW_SCENARIO, backendRequests.requests);
  });
});

function collectPageDiagnostics(page: Page): void {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const text = message.text();
      if (!isExpectedBrowserDiagnostic(text)) {
        console.log(`[browser:${message.type()}] ${text}`);
      }
    }
  });
  page.on('pageerror', (error) => {
    console.log(`[pageerror] ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    console.log(`[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
}

function isExpectedBrowserDiagnostic(text: string): boolean {
  return (
    text.includes("The Content Security Policy directive 'frame-ancestors' is ignored") ||
    text.includes("WebSocket connection to 'wss://hub.test.invalid/client/ws")
  );
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function transcriptScrollGap(page: Page): Promise<number> {
  return page.getByRole('log').evaluate((node) => {
    const element = node as HTMLElement;
    return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
  });
}

async function expectTranscriptWithoutModeDebug(transcript: ReturnType<Page['getByRole']>): Promise<void> {
  await expect(transcript).not.toContainText('Data:');
  await expect(transcript).not.toContainText('Hub replay:');
  await expect(transcript).not.toContainText('mock (auto fallback)');
  await expect(transcript).not.toContainText('demo+edge');
}

async function enterApprovedRealHubSession(
  page: Page,
  options: { activeTaskStatus?: string } = {},
): Promise<void> {
  await page.addInitScript(({ sessionId, taskId, status }) => {
    window.localStorage.setItem('agenthub.workbench.dataMode', 'approved-real');
    window.localStorage.setItem(`agenthub.web.activeAgentTask.${sessionId}`, JSON.stringify({
      taskId,
      sessionId,
      status,
    }));
    window.sessionStorage.setItem('agenthub_hub_token', 'stubbed-chat-flow-token');
    window.sessionStorage.setItem('agenthub_token_source', 'hub');
    window.sessionStorage.setItem('agenthub_hub_user', JSON.stringify({
      userId: 'user-chat-flow',
      username: 'chat-flow',
    }));
  }, { sessionId: SESSION_ID, taskId: TASK_ID, status: options.activeTaskStatus ?? 'running' });

  await page.goto('/');
}

interface ChatFlowHubStubOptions {
  messagePostDelayMs?: number;
  /**
   * Task status reported by the stubbed events/summary endpoints. Must stay
   * consistent with the status seeded into localStorage — a summary refresh
   * that disagrees with the stored task can flip the composer between the
   * Send and Stop controls mid-test.
   */
  taskStatus?: string;
}

async function installChatFlowHubStub(page: Page, options: ChatFlowHubStubOptions = {}): Promise<BackendRequestLog> {
  const endpoints = new Set<string>();
  const requests: E2EObservedRequest[] = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const boundary = classifyE2ERequest(request.url(), WEB_CHAT_FLOW_SCENARIO);

    if (boundary === 'app') {
      await route.continue();
      return;
    }

    if (boundary === 'hub') {
      endpoints.add(`${request.method()} ${url.pathname}`);
      requests.push({ method: request.method(), url: request.url() });

      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders() });
        return;
      }

      await fulfillHubRoute(route, request.method(), url.pathname, options);
      return;
    }

    if (boundary === 'local-edge' || boundary === 'tokendance-id' || boundary === 'gateway') {
      requests.push({ method: request.method(), url: request.url() });
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'blocked_by_e2e_data_mode_contract' }),
        headers: corsHeaders(),
      });
      return;
    }

    // Fail-closed external boundary: only the render-blocking Google Fonts
    // stylesheets are expected external requests (fulfilled with an empty
    // stylesheet so the document load event can fire). Every other external
    // host is recorded and refused, so the scenario assertion fails the test
    // instead of letting an unexpected remote call succeed silently.
    if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      return;
    }
    requests.push({ method: request.method(), url: request.url() });
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'blocked_by_e2e_data_mode_contract' }),
      headers: corsHeaders(),
    });
  });

  return { endpoints, requests };
}

async function fulfillHubRoute(
  route: Route,
  method: string,
  pathname: string,
  options: ChatFlowHubStubOptions,
): Promise<void> {
  if (pathname === '/client/auth/me') {
    await route.fulfill(json(hubEnvelope({
      id: 'user-chat-flow',
      username: 'chat-flow',
      nickname: 'Chat Flow',
      avatar_url: '',
    })));
    return;
  }

  if (pathname === '/client/sessions') {
    await route.fulfill(json(hubEnvelope([{
      id: SESSION_ID,
      type: 'group',
      name: 'Chat flow contract',
      member_count: 2,
      unread_count: 0,
    }])));
    return;
  }

  if (pathname === `/client/sessions/${SESSION_ID}/messages` && method === 'POST') {
    await delay(options.messagePostDelayMs ?? 0);
    await route.fulfill(json(hubEnvelope({
      message_id: 'message-chat-flow-submitted',
      seq_id: 2,
      created_at: '2026-06-26T08:00:08Z',
    })));
    return;
  }

  if (pathname === `/client/sessions/${SESSION_ID}/messages`) {
    await route.fulfill(json(hubEnvelope([{
      id: 'message-chat-flow-user',
      session_id: SESSION_ID,
      seq_id: 1,
      client_msg_id: 'client-chat-flow-user',
      sender_type: 'user',
      sender_id: 'user-chat-flow',
      sender: { nickname: 'Chat Flow' },
      content_type: 'text',
      content: 'Kick off the chat flow contract.',
      created_at: '2026-06-26T08:00:00Z',
    }])));
    return;
  }

  if (pathname === `/client/sessions/${SESSION_ID}/pins`) {
    await route.fulfill(json(hubEnvelope([])));
    return;
  }

  if (pathname === '/client/contacts' || pathname === '/client/notifications') {
    await route.fulfill(json(hubEnvelope([])));
    return;
  }

  if (pathname === '/web/agent-profiles') {
    await route.fulfill(json(hubEnvelope({ items: [], page: { hasMore: false } })));
    return;
  }

  if (pathname === '/web/projects') {
    await route.fulfill(json(hubEnvelope({ items: [], page: { hasMore: false } })));
    return;
  }

  if (pathname === '/web/execution-targets') {
    await route.fulfill(json(hubEnvelope({
      items: [{
        id: 'target-chat-flow',
        name: 'Chat Flow Desktop Edge',
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

  if (pathname === `/web/agent-tasks/${TASK_ID}/events`) {
    await route.fulfill(json(hubEnvelope(chatFlowEvents())));
    return;
  }

  if (pathname === `/web/agent-tasks/${TASK_ID}/events/summary`) {
    await route.fulfill(json(hubEnvelope({
      task_id: TASK_ID,
      edge_run_id: 'run-chat-flow',
      status: options.taskStatus ?? 'running',
      total_events: chatFlowEvents().length,
      last_event_seq: chatFlowEvents().length,
      event_type_counts: {},
      tool_call_count: 2,
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

  if (pathname === `/web/agent-tasks/${TASK_ID}/approvals`) {
    await route.fulfill(json(hubEnvelope({
      task_id: TASK_ID,
      edge_run_id: 'run-chat-flow',
      session_id: SESSION_ID,
      approvals: [],
      pending: [],
      decided: [],
      last_event_seq: chatFlowEvents().length,
    })));
    return;
  }

  if (pathname === `/web/agent-tasks/${TASK_ID}/artifacts`) {
    await route.fulfill(json(hubEnvelope({
      task_id: TASK_ID,
      edge_run_id: 'run-chat-flow',
      session_id: SESSION_ID,
      artifacts: [],
      last_event_seq: chatFlowEvents().length,
    })));
    return;
  }

  await route.fulfill(json(hubEnvelope({})));
}

async function submitComposerMessage(page: Page, message: string): Promise<void> {
  const composer = page.getByLabel('Composer input');
  const sendButton = page.getByRole('button', { name: /^(Send message|发送消息)$/ });
  await composer.fill(message);
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(composer).toHaveValue('');
}

async function installMessagePresenceProbe(page: Page, message: string): Promise<void> {
  await page.evaluate((text) => {
    const log = document.querySelector('[role="log"]');
    const state = {
      sawVisible: false,
      disappearedAfterVisible: false,
    };
    const sample = () => {
      const visible = Array.from(document.querySelectorAll('.user-bubble'))
        .some((node) => node.textContent?.includes(text));
      if (visible) state.sawVisible = true;
      if (state.sawVisible && !visible) state.disappearedAfterVisible = true;
    };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(log ?? document.body, { childList: true, subtree: true, characterData: true });
    (window as unknown as { __agenthubMessagePresenceProbe?: unknown }).__agenthubMessagePresenceProbe = state;
  }, message);
}

async function messagePresenceProbe(page: Page): Promise<{
  sawVisible: boolean;
  disappearedAfterVisible: boolean;
}> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __agenthubMessagePresenceProbe?: {
        sawVisible: boolean;
        disappearedAfterVisible: boolean;
      };
    }).__agenthubMessagePresenceProbe;
    return state ?? { sawVisible: false, disappearedAfterVisible: false };
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chatFlowEvents(): unknown[] {
  return [
    {
      id: 'evt-call-read-a',
      task_id: TASK_ID,
      edge_run_id: 'run-chat-flow',
      session_id: SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 1,
      event_type: 'run.agent.tool_call',
      payload: { callId: 'read-a', toolName: 'Read', path: 'src/a.ts' },
      created_at: '2026-06-26T08:00:01Z',
    },
    {
      id: 'evt-call-read-b',
      task_id: TASK_ID,
      edge_run_id: 'run-chat-flow',
      session_id: SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 2,
      event_type: 'run.agent.tool_call',
      payload: { callId: 'read-b', toolName: 'Read', path: 'src/b.ts' },
      created_at: '2026-06-26T08:00:02Z',
    },
    {
      id: 'evt-result-read-a',
      task_id: TASK_ID,
      edge_run_id: 'run-chat-flow',
      session_id: SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 3,
      event_type: 'run.agent.tool_result',
      payload: { callId: 'read-a', toolName: 'Read', summary: 'A result belongs to src/a.ts' },
      created_at: '2026-06-26T08:00:03Z',
    },
    {
      id: 'evt-result-read-b',
      task_id: TASK_ID,
      edge_run_id: 'run-chat-flow',
      session_id: SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 4,
      event_type: 'run.agent.tool_result',
      payload: { callId: 'read-b', toolName: 'Read', summary: 'B result belongs to src/b.ts' },
      created_at: '2026-06-26T08:00:04Z',
    },
    {
      id: 'evt-subtask-report',
      task_id: TASK_ID,
      edge_run_id: 'run-chat-flow',
      session_id: SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 5,
      event_type: 'run.agent.subagent_task',
      payload: {
        title: 'Deep report should stay in inspector',
        worker: 'Reviewer QA',
        status: 'running',
        summary: 'Inspector-only orchestration detail.',
      },
      created_at: '2026-06-26T08:00:05Z',
    },
    {
      id: 'evt-route-report',
      task_id: TASK_ID,
      edge_run_id: 'run-chat-flow',
      session_id: SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 6,
      event_type: 'run.agent.route_decision',
      payload: {
        action: 'fanout',
        nextWorker: 'Reviewer QA',
        summary: 'Route details belong to the inspector DAG.',
      },
      created_at: '2026-06-26T08:00:06Z',
    },
    {
      id: 'evt-markdown-summary',
      task_id: TASK_ID,
      edge_run_id: 'run-chat-flow',
      session_id: SESSION_ID,
      agent_instance_id: 'agent-builder',
      agent_label: 'Builder',
      event_seq: 7,
      event_type: 'run.agent.text_block',
      payload: {
        content: [
          'The replay summary is below.',
          '',
          '| Check | Status |',
          '| --- | --- |',
          '| order | ordered |',
        ].join('\n'),
      },
      created_at: '2026-06-26T08:00:07Z',
    },
  ];
}

function hubEnvelope<T>(data: T): { code: string; data: T } {
  return { code: 'ok', data };
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  };
}

function json(body: unknown): {
  status: number;
  contentType: string;
  body: string;
  headers: Record<string, string>;
} {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
    headers: corsHeaders(),
  };
}
