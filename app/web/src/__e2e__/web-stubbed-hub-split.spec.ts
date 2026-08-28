/**
 * Web stubbed-hub split view E2E (#1997, UX F3).
 *
 * Mock surface: two Hub sessions behind the fail-closed route stub. Covers
 * the honest split flow end-to-end:
 *   - Split Right creates a second pane WITHOUT remounting the active
 *     conversation host (DOM-node identity probe → streaming not interrupted);
 *   - a sidebar click drops the second conversation into the inactive pane
 *     (parallel review: both transcripts visible at once);
 *   - Unsplit restores the single group, still without remounting the host.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import {
  assertE2EDataModeScenario,
  classifyE2ERequest,
  createE2EDataModeScenario,
  type E2EObservedRequest,
} from '../../../shared/src/testing/e2eDataModeContract';
import { fulfillExternalFontIfMatch } from '../../../e2e/fontBlocker';

// Must match playwright.config.ts webServer VITE_HUB_URL: the fail-closed
// reserved origin keeps every Hub call inside the route stub.
const HUB_ORIGIN = 'https://hub.test.invalid';
const WEB_E2E_PORT = Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5174);
const WEB_E2E_APP_ORIGIN = `http://127.0.0.1:${WEB_E2E_PORT}`;

const SESSION_A = 'session-split-a';
const SESSION_B = 'session-split-b';
const TASK_A = 'task-split-a';
const DESKTOP_WORKSPACE_VIEWPORT = { width: 1440, height: 810 };

const WEB_SPLIT_SCENARIO = createE2EDataModeScenario({
  name: 'web-split-view',
  surface: 'web',
  dataMode: 'approved-real',
  dataSource: 'stubbed-hub-session',
  appOrigin: WEB_E2E_APP_ORIGIN,
  hubOrigin: HUB_ORIGIN,
  mockAdapterUsed: true,
});

test.describe('Web split view (stubbed hub)', () => {
  test('split, parallel review and unsplit keep the active host mounted', async ({ page }) => {
    collectPageDiagnostics(page);
    const backendRequests = await installSplitHubStub(page);
    await enterApprovedRealSplitSession(page);
    expect(page.viewportSize()).toEqual(DESKTOP_WORKSPACE_VIEWPORT);

    // ── Baseline: single group, session A active ──────────────────────────
    const activeLog = page.locator('[data-split-pane][data-split-active="true"] [role="log"]');
    await expect(page.getByRole('heading', { name: 'Split Alpha' })).toBeVisible();
    await expect(activeLog).toContainText('Kick off split alpha.');
    await expect(activeLog).toContainText('Alpha runtime event landed.');
    await expect(page.locator('[data-split-pane]')).toHaveCount(1);

    // Streaming-interruption probe: pin the exact transcript DOM node. A
    // remount (forbidden by the layout contract) replaces this node.
    await page.evaluate(() => {
      const node = document.querySelector('[data-split-active="true"] [role="log"]');
      const probeTarget = window as unknown as { __splitProbeLog?: Element };
      if (node) {
        probeTarget.__splitProbeLog = node;
      } else {
        delete probeTarget.__splitProbeLog;
      }
      node?.setAttribute('data-split-probe', 'mounted');
    });

    // ── Split Right via the conversation-header context menu ───────────────
    await page.getByTestId('workbench-split-menu').click();
    await page.getByRole('menuitem', { name: /向右分屏|Split Right/ }).click();

    await expect(page.locator('[data-split-pane]')).toHaveCount(2);
    await expect(page.locator('main[data-split="true"]')).toBeVisible();
    // The fresh pane is honest: it asks for a conversation pick.
    await expect(page.getByTestId('split-pane-empty')).toContainText(/从左侧会话列表选择一个会话|Pick a conversation/);

    // Hard contract: the active conversation host was NOT remounted by the
    // layout change — the probed node is still the live transcript.
    await expect.poll(() => probeStillMounted(page)).toBe(true);
    await expect(activeLog).toContainText('Alpha runtime event landed.');

    // ── Sidebar click drops session B into the inactive pane ───────────────
    await page.locator('li[role="option"]', { hasText: 'Split Beta' }).first().click();

    await expect(page.getByRole('heading', { name: 'Split Beta' })).toBeVisible();
    // Parallel review: both transcripts visible at the same time.
    await expect(page.locator('[data-split-pane][data-split-active="true"]')).toContainText('Hello from split beta.');
    await expect(page.locator('[data-split-pane][data-split-active="false"]')).toContainText('Alpha runtime event landed.');
    // Single-active contract: exactly one composer receives input.
    await expect(page.locator('textarea')).toHaveCount(1);
    // Still no remount of the live host across split + conversation switch.
    await expect.poll(() => probeStillMounted(page)).toBe(true);

    // ── Unsplit restores the single group ──────────────────────────────────
    await page.getByTestId('workbench-split-menu').click();
    await page.getByRole('menuitem', { name: /取消分屏|Unsplit/ }).click();

    await expect(page.locator('[data-split-pane]')).toHaveCount(1);
    await expect(page.locator('main[data-split="true"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Split Beta' })).toBeVisible();
    await expect(page.getByRole('log')).toContainText('Hello from split beta.');
    await expect.poll(() => probeStillMounted(page)).toBe(true);

    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await expect(page.getByText('mock (auto fallback)')).toHaveCount(0);
    await expect.poll(() => backendRequests.endpoints.has(`GET /client/sessions/${SESSION_B}/messages`)).toBe(true);
    assertE2EDataModeScenario(WEB_SPLIT_SCENARIO, backendRequests.requests);
  });
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

async function probeStillMounted(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __splitProbeLog?: Element }).__splitProbeLog;
    return Boolean(
      probe
        && probe.isConnected
        && probe.getAttribute('data-split-probe') === 'mounted'
        && probe.closest('[data-split-active="true"]') !== null,
    );
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

function collectPageDiagnostics(page: Page): void {
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[console.error] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    console.log(`[pageerror] ${error.message}`);
  });
}

async function enterApprovedRealSplitSession(page: Page): Promise<void> {
  await page.addInitScript(({ sessionId, taskId }) => {
    window.localStorage.setItem('agenthub.workbench.dataMode', 'approved-real');
    // Fresh split state — a leftover layout blob must not change this flow.
    window.localStorage.removeItem('agenthub.workbench.splitLayout');
    window.localStorage.setItem(`agenthub.web.activeAgentTask.${sessionId}`, JSON.stringify({
      taskId,
      sessionId,
      status: 'running',
    }));
    window.sessionStorage.setItem('agenthub_hub_token', 'stubbed-split-token');
    window.sessionStorage.setItem('agenthub_token_source', 'hub');
    window.sessionStorage.setItem('agenthub_hub_user', JSON.stringify({
      userId: 'user-split',
      username: 'split',
    }));
  }, { sessionId: SESSION_A, taskId: TASK_A });

  await page.goto('/');
}

interface BackendRequestLog {
  endpoints: Set<string>;
  requests: E2EObservedRequest[];
}

async function installSplitHubStub(page: Page): Promise<BackendRequestLog> {
  const endpoints = new Set<string>();
  const requests: E2EObservedRequest[] = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const boundary = classifyE2ERequest(request.url(), WEB_SPLIT_SCENARIO);

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

      await fulfillHubRoute(route, request.method(), url.pathname);
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

    // Shared font interception (#2014): the render-blocking Google Fonts
    // stylesheets get an empty stylesheet so the document load event can fire.
    if (await fulfillExternalFontIfMatch(route)) {
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

async function fulfillHubRoute(route: Route, method: string, pathname: string): Promise<void> {
  if (pathname === '/client/auth/me') {
    await route.fulfill(json(hubEnvelope({
      id: 'user-split',
      username: 'split',
      nickname: 'Split',
      avatar_url: '',
    })));
    return;
  }

  if (pathname === '/client/sessions') {
    await route.fulfill(json(hubEnvelope([
      {
        id: SESSION_A,
        type: 'group',
        name: 'Split Alpha',
        member_count: 2,
        unread_count: 0,
      },
      {
        id: SESSION_B,
        type: 'group',
        name: 'Split Beta',
        member_count: 2,
        unread_count: 0,
      },
    ])));
    return;
  }

  if (pathname === `/client/sessions/${SESSION_A}/messages` && method === 'GET') {
    await route.fulfill(json(hubEnvelope([
      sessionMessage(SESSION_A, 'message-split-a-user', 'user', 'Kick off split alpha.', '2026-08-28T08:00:00Z'),
    ])));
    return;
  }

  if (pathname === `/client/sessions/${SESSION_B}/messages` && method === 'GET') {
    await route.fulfill(json(hubEnvelope([
      sessionMessage(SESSION_B, 'message-split-b-user', 'user', 'Hello from split beta.', '2026-08-28T08:05:00Z'),
    ])));
    return;
  }

  if (pathname === `/client/sessions/${SESSION_A}/pins` || pathname === `/client/sessions/${SESSION_B}/pins`) {
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
        id: 'target-split',
        name: 'Split Desktop Edge',
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

  if (pathname === `/web/agent-tasks/${TASK_A}/events`) {
    await route.fulfill(json(hubEnvelope([
      {
        id: 'evt-split-text',
        task_id: TASK_A,
        edge_run_id: 'run-split-a',
        session_id: SESSION_A,
        agent_instance_id: 'agent-builder',
        agent_label: 'Builder',
        event_seq: 1,
        event_type: 'run.agent.text_block',
        payload: { content: 'Alpha runtime event landed.' },
        created_at: '2026-08-28T08:00:01Z',
      },
    ])));
    return;
  }

  if (pathname === `/web/agent-tasks/${TASK_A}/events/summary`) {
    await route.fulfill(json(hubEnvelope({
      task_id: TASK_A,
      edge_run_id: 'run-split-a',
      status: 'running',
      total_events: 1,
      last_event_seq: 1,
      event_type_counts: {},
      tool_call_count: 0,
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

  if (pathname === `/web/agent-tasks/${TASK_A}/approvals`) {
    await route.fulfill(json(hubEnvelope({
      task_id: TASK_A,
      edge_run_id: 'run-split-a',
      session_id: SESSION_A,
      approvals: [],
      pending: [],
      decided: [],
      last_event_seq: 1,
    })));
    return;
  }

  await route.fulfill(json(hubEnvelope(null)));
}

function sessionMessage(
  sessionId: string,
  id: string,
  senderType: string,
  content: string,
  createdAt: string,
): Record<string, unknown> {
  return {
    id,
    session_id: sessionId,
    seq_id: 1,
    client_msg_id: `client-${id}`,
    sender_type: senderType,
    sender_id: 'user-split',
    sender: { nickname: 'Split' },
    content_type: 'text',
    content,
    created_at: createdAt,
  };
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
