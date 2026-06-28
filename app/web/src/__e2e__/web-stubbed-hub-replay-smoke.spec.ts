import { expect, test, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildE2EDataModeManifest,
  classifyE2ERequest,
  createE2EDataModeScenario,
  resolveE2ERequestDecision,
  type E2EObservedRequest,
} from '../../../shared/src/testing/e2eDataModeContract';

const ARTIFACT_DIR = path.resolve(process.cwd(), '.tmp', 'web-stubbed-hub-replay-smoke');
const HUB_ORIGIN = 'http://localhost:8080';
const WEB_E2E_PORT = Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5174);
const WEB_E2E_APP_ORIGIN = `http://127.0.0.1:${WEB_E2E_PORT}`;
const WEB_HUB_SMOKE_SCENARIO = createE2EDataModeScenario({
  name: 'web-stubbed-hub-replay-smoke',
  surface: 'web',
  dataMode: 'approved-real',
  dataSource: 'stubbed-hub-session',
  appOrigin: WEB_E2E_APP_ORIGIN,
  hubOrigin: HUB_ORIGIN,
  mockAdapterUsed: true,
});

test.describe('Web stubbed Hub replay smoke', () => {
  test.beforeEach(async ({ page }) => {
    collectPageDiagnostics(page);
  });

  test('shows signed-out Hub state in approved-real mode without demo fallback', async ({ page }) => {
    const requests = await installHubStub(page);
    await setApprovedRealMode(page);
    await page.goto('/');

    await expect(page.getByTestId('agenthub-workbench')).toHaveAttribute('data-page', 'chat');
    await expect(page.getByRole('status').filter({ hasText: 'Data: approved-real' })).toBeVisible();
    await expect(page.getByText('Target: signed-out')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Hub replay: no active Hub session' })).toBeVisible();
    await expect(page.getByText('Sign in to Hub before Web can select a local_edge execution target.')).toBeVisible();

    await page.getByRole('button', { name: 'Projects' }).click();
    await expect(page.getByRole('region', { name: 'Workbench page' })).toContainText(
      'Sign in to Hub to load workspace projects.',
    );
    buildE2EDataModeManifest(WEB_HUB_SMOKE_SCENARIO, requests.requests, {
      scenario: 'signed-out',
    });
  });

  test('blocks Local Edge, TokenDance ID, and Gateway requests during guarded Web replay', async ({ page }) => {
    const requests = await startAuthenticatedHubSmoke(page, 'healthy-target', { activeTask: false });

    await expect(page.getByText('Target: ready - Smoke Desktop Edge (target-web-smoke)')).toBeVisible();
    const blocked = await page.evaluate(async () => {
      const urls = [
        'http://127.0.0.1:3210/v1/health',
        'https://id.vectorcontrol.tech/oidc/authorize',
        'https://api.vectorcontrol.tech/v1/models',
      ];
      return Promise.all(urls.map(async (url) => {
        try {
          const response = await fetch(url);
          return {
            url,
            status: response.status,
            body: await response.json(),
          };
        } catch (error) {
          return {
            url,
            status: 'blocked-by-browser',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }));
    });

    expect(blocked).toEqual([
      {
        url: 'http://127.0.0.1:3210/v1/health',
        status: 'blocked-by-browser',
        error: 'Failed to fetch',
      },
      {
        url: 'https://id.vectorcontrol.tech/oidc/authorize',
        status: 503,
        body: { code: 'blocked_by_e2e_data_mode_contract' },
      },
      {
        url: 'https://api.vectorcontrol.tech/v1/models',
        status: 503,
        body: { code: 'blocked_by_e2e_data_mode_contract' },
      },
    ]);

    expect(Array.from(new Set(
      requests.requests
        .map((request) => classifyE2ERequest(request.url, WEB_HUB_SMOKE_SCENARIO))
        .filter((boundary) => boundary !== 'hub'),
    )).sort()).toEqual(['gateway', 'tokendance-id']);
    expect(requests.requests.filter((request) => (
      classifyE2ERequest(request.url, WEB_HUB_SMOKE_SCENARIO) === 'hub'
    )).length).toBeGreaterThan(0);
    await expect(page.getByText('mock (auto fallback)')).toHaveCount(0);
  });

  test('renders Hub session and no-target blocker from a stubbed Hub replay', async ({ page }) => {
    const requests = await startAuthenticatedHubSmoke(page, 'no-target');

    await expect(page.getByRole('heading', { name: 'Stubbed Hub replay smoke' })).toBeVisible();
    await expect(page.getByText('Target: no-target')).toBeVisible();
    await expect(page.getByText('No online local_edge execution target is available.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Hub replay: task task-web-smoke' })).toBeVisible();
    await expect(page.getByText('reports/web-stubbed-replay-smoke.md').first()).toBeVisible();

    await page.getByRole('button', { name: 'Projects' }).click();
    await expect(page.getByRole('region', { name: 'Workbench page' })).toContainText('Hub Smoke Project');
    await page.getByRole('button', { name: 'Agent' }).click();
    await expect(page.getByRole('region', { name: 'Workbench page' })).toContainText('Hub Smoke Builder');
    await page.getByRole('button', { name: 'Tasks' }).click();
    await expect(page.getByRole('region', { name: 'Workbench page' })).toContainText('Hub tasks are not loaded in this replay.');

    await writeSmokeArtifact(page, 'no-target', requests);
  });

  test('renders healthy Hub target, transcript, Projects, Agents, Tasks, and Inspector evidence from a stubbed Hub replay', async ({ page }) => {
    const requests = await startAuthenticatedHubSmoke(page, 'healthy-target');

    await expect(page.getByText('Target: ready - Smoke Desktop Edge (target-web-smoke)')).toBeVisible();
    await expect(page.getByText('Selected local_edge execution target: Smoke Desktop Edge')).toBeVisible();
    await expect(page.getByLabel('Desktop/Edge target')).toContainText('Smoke Desktop Edge (target-web-smoke)');
    await expect(page.getByText('Review the Web -> Hub stubbed replay boundary.')).toBeVisible();
    await page
      .locator('[data-block-id="edge-event-hub-runtime-event-web-smoke-approval"]')
      .getByRole('button', { name: 'Expand' })
      .click();
    await expect(page.getByText('Stubbed Hub replay approval')).toBeVisible();
    await expect(page.getByText('reports/web-stubbed-replay-smoke.md').first()).toBeVisible();
    await expect(page.getByText('运行证据').first()).toBeVisible();
    await expect(page.getByText('Hub replay artifact index: 1')).toBeVisible();

    await page.getByRole('button', { name: 'Projects' }).click();
    await expect(page.getByRole('region', { name: 'Workbench page' })).toContainText('Hub Smoke Project');
    await page.getByRole('button', { name: 'Agent' }).click();
    await expect(page.getByRole('region', { name: 'Workbench page' })).toContainText('Hub Smoke Builder');
    await page.getByRole('button', { name: 'Tasks' }).click();
    await expect(page.getByRole('region', { name: 'Workbench page' })).toContainText('Hub tasks are not loaded in this replay.');

    await expect.poll(() => requests.endpoints.has('GET /client/auth/me')).toBe(true);
    await expect.poll(() => requests.endpoints.has('GET /client/sessions')).toBe(true);
    await expect.poll(() => requests.endpoints.has('GET /web/execution-targets')).toBe(true);
    await expect.poll(() => requests.endpoints.has('GET /web/projects')).toBe(true);
    await expect.poll(() => requests.endpoints.has('GET /web/agent-profiles')).toBe(true);
    await expect.poll(() => requests.endpoints.has('GET /web/agent-tasks/task-web-smoke/approvals')).toBe(true);
    await expect.poll(() => requests.endpoints.has('GET /web/agent-tasks/task-web-smoke/artifacts')).toBe(true);

    await writeSmokeArtifact(page, 'healthy-target', requests);
  });

  test('creates a Hub task from Web target selection and hydrates replay through Hub only', async ({ page }) => {
    const requests = await startAuthenticatedHubSmoke(page, 'healthy-target', { activeTask: false });
    const dispatch = hubDispatchCapture(page);

    await expect(page.getByText('Target: ready - Smoke Desktop Edge (target-web-smoke)')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Hub replay: 0 runtime events observed' })).toBeVisible();

    await page.getByLabel('@Agent').selectOption('agent-profile-web-smoke');
    await page.getByLabel('Desktop/Edge target').selectOption('target-web-smoke');
    await page.getByLabel('Composer input').fill('Create a Hub-routed remote control task.');
    await page.getByRole('button', { name: 'Start agent task' }).click();

    await expect(page.getByText('Hub replay: task task-web-created')).toBeVisible();
    const transcript = page.getByRole('log');
    await expect(transcript).toContainText('Create a Hub-routed remote control task.');
    await expect(transcript).toContainText('Created task replay hydrated from Hub.');
    await expect(page.getByText('reports/web-created-task.md').first()).toBeVisible();
    const order = await transcript.evaluate((node) => {
      const text = node.textContent ?? '';
      return {
        user: text.indexOf('Create a Hub-routed remote control task.'),
        reply: text.indexOf('Created task replay hydrated from Hub.'),
      };
    });
    expect(order.user).toBeGreaterThanOrEqual(0);
    expect(order.reply).toBeGreaterThan(order.user);

    await expect.poll(() => requests.endpoints.has('POST /client/sessions/session-web-smoke/messages')).toBe(true);
    await expect.poll(() => requests.endpoints.has('POST /client/sessions/session-web-smoke/agents')).toBe(true);
    await expect.poll(() => requests.endpoints.has('POST /web/agent-tasks')).toBe(true);
    await expect.poll(() => requests.endpoints.has('GET /web/agent-tasks/task-web-created/events')).toBe(true);
    await expect.poll(() => requests.endpoints.has('GET /web/agent-tasks/task-web-created/summary')).toBe(true);
    await expect.poll(() => requests.endpoints.has('GET /web/agent-tasks/task-web-created/approvals')).toBe(true);
    await expect.poll(() => requests.endpoints.has('GET /web/agent-tasks/task-web-created/artifacts')).toBe(true);
    await expect.poll(dispatch).toMatchObject({
      triggerMessageId: 'message-web-created',
      targetId: 'target-web-smoke',
      directLocalEdge: false,
    });

    await writeSmokeArtifact(page, 'task-create-hydration', requests);
  });

  test('surfaces Hub target inventory errors without contacting Local Edge', async ({ page }) => {
    const requests = await startAuthenticatedHubSmoke(page, 'target-error', { activeTask: false });

    await expect(page.getByText('Target: error')).toBeVisible();
    await expect(page.getByText('Hub execution targets unavailable: Hub target inventory unavailable')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Hub replay: 0 runtime events observed' })).toBeVisible();
    await expect.poll(() => requests.endpoints.has('GET /web/execution-targets')).toBe(true);
    await expect.poll(() => requests.requests.some((request) => request.url.includes('3210'))).toBe(false);

    await writeSmokeArtifact(page, 'target-error', requests);
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
    const errorText = request.failure()?.errorText ?? '';
    if (isExpectedRequestFailure(request.url(), errorText)) return;
    console.log(`[requestfailed] ${request.method()} ${request.url()} ${errorText}`);
  });
}

function isExpectedBrowserDiagnostic(text: string): boolean {
  return (
    text.includes("The Content Security Policy directive 'frame-ancestors' is ignored") ||
    text.includes("Connecting to 'http://127.0.0.1:3210/v1/health' violates the following Content Security Policy directive") ||
    text.includes('Fetch API cannot load http://127.0.0.1:3210/v1/health') ||
    text.includes("WebSocket connection to 'ws://localhost:8080/client/ws") ||
    text.includes('Failed to load resource: the server responded with a status of 503') ||
    text.includes('[API] target_inventory_unavailable (HTTP 503): Hub target inventory unavailable') ||
    text.includes('Failed to load resource: net::ERR_BLOCKED_BY_CLIENT')
  );
}

function isExpectedRequestFailure(url: string, errorText: string): boolean {
  return errorText.includes('ERR_BLOCKED_BY_CLIENT') && url.startsWith('https://fonts.googleapis.com/');
}

type HubScenario = 'no-target' | 'healthy-target' | 'target-error';

interface HubSmokeOptions {
  activeTask?: boolean;
}

interface BackendRequestLog {
  endpoints: Set<string>;
  requests: E2EObservedRequest[];
}

interface DispatchCapture {
  triggerMessageId?: string;
  targetId?: string;
  directLocalEdge: boolean;
}

async function setApprovedRealMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('agenthub.workbench.dataMode', 'approved-real');
  });
}

async function startAuthenticatedHubSmoke(
  page: Page,
  scenario: HubScenario,
  options: HubSmokeOptions = {},
): Promise<BackendRequestLog> {
  const requests = await installHubStub(page, scenario);
  await page.addInitScript(({ activeTask }) => {
    window.localStorage.setItem('agenthub.workbench.dataMode', 'approved-real');
    window.sessionStorage.setItem('agenthub_hub_token', 'stubbed-hub-token');
    window.sessionStorage.setItem('agenthub_token_source', 'hub');
    window.sessionStorage.setItem('agenthub_hub_user', JSON.stringify({
      userId: 'user-web-smoke',
      username: 'web-smoke',
    }));
    if (activeTask) {
      window.localStorage.setItem('agenthub.web.activeAgentTask.session-web-smoke', JSON.stringify({
        taskId: 'task-web-smoke',
        sessionId: 'session-web-smoke',
        status: 'running',
      }));
    } else {
      window.localStorage.removeItem('agenthub.web.activeAgentTask.session-web-smoke');
    }
    window.sessionStorage.removeItem('agenthub.web.dispatchCapture');
  }, { activeTask: options.activeTask ?? true });

  await page.goto('/');
  return requests;
}

async function installHubStub(page: Page, scenario: HubScenario = 'healthy-target'): Promise<BackendRequestLog> {
  const endpoints = new Set<string>();
  const requests: E2EObservedRequest[] = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const decision = resolveE2ERequestDecision(WEB_HUB_SMOKE_SCENARIO, {
      method: request.method(),
      url: request.url(),
    });

    if (decision.action === 'continue') {
      return route.continue();
    }

    if (decision.shouldRecord) {
      requests.push(decision.request);
    }

    if (decision.action === 'fulfill-scenario-backend' && decision.boundary === 'hub') {
      endpoints.add(`${request.method()} ${url.pathname}`);

      if (request.method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: corsHeaders() });
      }

      return fulfillHubRoute(page, route, url.pathname, scenario);
    }

    if (decision.action === 'block-forbidden-backend') {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'blocked_by_e2e_data_mode_contract' }),
        headers: corsHeaders(),
      });
    }

    return route.abort('blockedbyclient');
  });

  return { endpoints, requests };
}

async function fulfillHubRoute(page: Page, route: Route, pathname: string, scenario: HubScenario): Promise<void> {
  if (pathname === '/client/auth/me') {
    return route.fulfill(json(hubEnvelope({
      id: 'user-web-smoke',
      username: 'web-smoke',
      nickname: 'Web Smoke',
      avatar_url: '',
    })));
  }

  if (pathname === '/client/sessions') {
    return route.fulfill(json(hubEnvelope([{
      id: 'session-web-smoke',
      type: 'group',
      name: 'Stubbed Hub replay smoke',
      member_count: 3,
      unread_count: 0,
    }])));
  }

  if (pathname === '/client/sessions/session-web-smoke/messages') {
    if (route.request().method() === 'POST') {
      return route.fulfill(json(hubEnvelope({
        message_id: 'message-web-created',
        seq_id: 2,
        created_at: '2026-06-09T08:01:00Z',
      })));
    }
    return route.fulfill(json(hubEnvelope([{
      id: 'message-web-smoke-1',
      session_id: 'session-web-smoke',
      seq_id: 1,
      client_msg_id: 'client-web-smoke-1',
      sender_type: 'user',
      sender_id: 'user-web-smoke',
      content_type: 'text',
      content: 'Review the Web -> Hub stubbed replay boundary.',
      created_at: '2026-06-09T08:00:00Z',
    }])));
  }

  if (pathname === '/client/sessions/session-web-smoke/agents' && route.request().method() === 'POST') {
    return route.fulfill(json(hubEnvelope({
      id: 'agent-instance-web-smoke',
      agent_type: 'codex',
      session_id: 'session-web-smoke',
      inviter_user_id: 'user-web-smoke',
      display_name: 'Hub Smoke Builder',
      created_at: '2026-06-09T08:01:01Z',
    })));
  }

  if (pathname === '/client/sessions/session-web-smoke/pins') {
    return route.fulfill(json(hubEnvelope([])));
  }

  if (pathname === '/client/contacts' || pathname === '/client/notifications') {
    return route.fulfill(json(hubEnvelope([])));
  }

  if (pathname === '/web/agent-profiles') {
    return route.fulfill(json(hubEnvelope({
      items: [{
        id: 'agent-profile-web-smoke',
        name: 'Hub Smoke Builder',
        description: 'Stubbed Hub Agent Profile for replay smoke',
        runtime_id: 'codex',
        model: 'gpt-5-codex',
        provider: 'codex',
        permission_mode: 'workspace-write',
        approval_policy: 'on-request',
        skills: '[]',
        tool_allowlist: '["Read","rg","Write"]',
      }],
      page: { hasMore: false },
    })));
  }

  if (pathname === '/web/projects') {
    return route.fulfill(json(hubEnvelope({
      items: [{
        id: 'project-web-smoke',
        name: 'Hub Smoke Project',
        description: 'Workspace project loaded from the Hub stub.',
        owner_id: 'user-web-smoke',
        created_at: '2026-06-09T08:00:00Z',
        updated_at: '2026-06-09T08:00:00Z',
      }],
      page: { hasMore: false },
    })));
  }

  if (pathname === '/web/projects/project-web-smoke') {
    return route.fulfill(json(hubEnvelope({
      id: 'project-web-smoke',
      name: 'Hub Smoke Project',
      description: 'Workspace project detail loaded from the Hub stub.',
      owner_id: 'user-web-smoke',
      created_at: '2026-06-09T08:00:00Z',
      updated_at: '2026-06-09T08:00:00Z',
    })));
  }

  if (pathname === '/web/projects/project-web-smoke/threads') {
    return route.fulfill(json(hubEnvelope([])));
  }

  if (pathname.startsWith('/web/projects/project-web-smoke/threads/') && pathname.endsWith('/messages')) {
    return route.fulfill(json(hubEnvelope([])));
  }

  if (pathname === '/web/execution-targets') {
    if (scenario === 'target-error') {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'target_inventory_unavailable', message: 'Hub target inventory unavailable' }),
        headers: corsHeaders(),
      });
    }
    return route.fulfill(json(hubEnvelope({
      items: scenario === 'healthy-target' ? [{
        id: 'target-web-smoke',
        name: 'Smoke Desktop Edge',
        target_type: 'local_edge',
        device_id: 'device-web-smoke',
        workspace_allowlist: [],
        trust_level: 'local',
        health_state: 'healthy',
        is_online: true,
        last_seen_at: '2026-06-09T08:00:00Z',
      }] : [],
      page: { hasMore: false },
    })));
  }

  if (pathname === '/web/agent-tasks' && route.request().method() === 'POST') {
    const body = await route.request().postDataJSON() as Record<string, unknown>;
    const capture: DispatchCapture = {
      directLocalEdge: false,
      ...(typeof body.trigger_message_id === 'string' ? { triggerMessageId: body.trigger_message_id } : {}),
      ...(typeof body.target_id === 'string' ? { targetId: body.target_id } : {}),
    };
    await page.evaluate((payload) => {
      window.sessionStorage.setItem('agenthub.web.dispatchCapture', JSON.stringify(payload));
    }, capture);
    return route.fulfill(json(hubEnvelope({
      id: 'task-web-created',
      agent_instance_id: 'agent-instance-web-smoke',
      triggered_by_user_id: 'user-web-smoke',
      trigger_message_id: 'message-web-created',
      target_id: 'target-web-smoke',
      status: 'queued',
      edge_device_id: 'device-web-smoke',
    })));
  }

  if (pathname === '/web/agent-tasks/task-web-smoke/events') {
    return route.fulfill(json(hubEnvelope([{
      id: 'event-web-smoke-1',
      task_id: 'task-web-smoke',
      edge_run_id: 'edge-run-web-smoke',
      session_id: 'session-web-smoke',
      agent_instance_id: 'agent-instance-web-smoke',
      event_seq: 1,
      event_type: 'run.agent.tool_call',
      payload: {
        toolName: 'Read',
        args: { path: 'README.md' },
        agent_task_id: 'task-web-smoke',
        edge_run_id: 'edge-run-web-smoke',
      },
      created_at: '2026-06-09T08:00:01Z',
    }])));
  }

  if (pathname === '/web/agent-tasks/task-web-created/events') {
    return route.fulfill(json(hubEnvelope([{
      id: 'event-web-created-1',
      task_id: 'task-web-created',
      edge_run_id: 'edge-run-web-created',
      session_id: 'session-web-smoke',
      agent_instance_id: 'agent-instance-web-smoke',
      event_seq: 1,
      event_type: 'run.agent.text_block',
      payload: {
        content: 'Created task replay hydrated from Hub.',
      },
      created_at: '2026-06-09T08:01:02Z',
    }])));
  }

  if (pathname === '/web/agent-tasks/task-web-smoke/summary') {
    return route.fulfill(json(hubEnvelope({
      task_id: 'task-web-smoke',
      edge_run_id: 'edge-run-web-smoke',
      status: 'running',
      total_events: 3,
      last_event_seq: 3,
      event_type_counts: {},
      tool_call_count: 1,
      step_count: 1,
      artifact_count: 1,
      approval_count: 1,
      pending_approvals: 1,
      decided_approvals: 0,
      input_tokens: 0,
      output_tokens: 0,
      output_bytes: 0,
    })));
  }

  if (pathname === '/web/agent-tasks/task-web-created/summary') {
    return route.fulfill(json(hubEnvelope({
      task_id: 'task-web-created',
      edge_run_id: 'edge-run-web-created',
      status: 'running',
      total_events: 1,
      last_event_seq: 1,
      event_type_counts: { 'run.agent.text_block': 1 },
      tool_call_count: 0,
      step_count: 0,
      artifact_count: 1,
      approval_count: 0,
      pending_approvals: 0,
      decided_approvals: 0,
      input_tokens: 0,
      output_tokens: 0,
      output_bytes: 0,
    })));
  }

  if (pathname === '/web/agent-tasks/task-web-smoke/approvals') {
    return route.fulfill(json(hubEnvelope({
      task_id: 'task-web-smoke',
      edge_run_id: 'edge-run-web-smoke',
      session_id: 'session-web-smoke',
      approvals: [{
        approval_id: 'approval-web-smoke-1',
        task_id: 'task-web-smoke',
        edge_run_id: 'edge-run-web-smoke',
        session_id: 'session-web-smoke',
        source_event_id: 'event-web-smoke-approval',
        event_seq: 2,
        request_id: 'perm-web-smoke-1',
        tool_name: 'Write',
        status: 'pending',
        reason: 'Stubbed Hub replay approval',
        created_at: '2026-06-09T08:00:02Z',
      }],
      pending: [],
      decided: [],
      last_event_seq: 2,
    })));
  }

  if (pathname === '/web/agent-tasks/task-web-created/approvals') {
    return route.fulfill(json(hubEnvelope({
      task_id: 'task-web-created',
      edge_run_id: 'edge-run-web-created',
      session_id: 'session-web-smoke',
      approvals: [],
      pending: [],
      decided: [],
      last_event_seq: 1,
    })));
  }

  if (pathname === '/web/agent-tasks/task-web-smoke/artifacts') {
    return route.fulfill(json(hubEnvelope({
      task_id: 'task-web-smoke',
      edge_run_id: 'edge-run-web-smoke',
      session_id: 'session-web-smoke',
      artifacts: [{
        task_id: 'task-web-smoke',
        edge_run_id: 'edge-run-web-smoke',
        session_id: 'session-web-smoke',
        source_event_id: 'event-web-smoke-artifact',
        event_seq: 3,
        artifact_id: 'artifact-web-smoke-1',
        path: 'reports/web-stubbed-replay-smoke.md',
        action: 'created',
        type: 'artifact',
        tool_name: 'Write',
        mime_type: 'text/markdown',
        size_bytes: 512,
        created_at: '2026-06-09T08:00:03Z',
      }],
      last_event_seq: 3,
    })));
  }

  if (pathname === '/web/agent-tasks/task-web-created/artifacts') {
    return route.fulfill(json(hubEnvelope({
      task_id: 'task-web-created',
      edge_run_id: 'edge-run-web-created',
      session_id: 'session-web-smoke',
      artifacts: [{
        task_id: 'task-web-created',
        edge_run_id: 'edge-run-web-created',
        session_id: 'session-web-smoke',
        source_event_id: 'event-web-created-artifact',
        event_seq: 2,
        artifact_id: 'artifact-web-created-1',
        path: 'reports/web-created-task.md',
        action: 'created',
        type: 'artifact',
        tool_name: 'Write',
        mime_type: 'text/markdown',
        size_bytes: 256,
        created_at: '2026-06-09T08:01:03Z',
      }],
      last_event_seq: 2,
    })));
  }

  return route.fulfill(json(hubEnvelope({})));
}

function hubDispatchCapture(page: Page): () => Promise<DispatchCapture | null> {
  return async () => page.evaluate(() => {
    const raw = window.sessionStorage.getItem('agenthub.web.dispatchCapture');
    return raw ? JSON.parse(raw) as DispatchCapture : null;
  });
}

async function writeSmokeArtifact(page: Page, scenario: string, requests: BackendRequestLog): Promise<void> {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const screenshotPath = path.join(ARTIFACT_DIR, `${scenario}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const manifestPath = path.join(ARTIFACT_DIR, `${scenario}.manifest.json`);
  const manifest = buildE2EDataModeManifest(WEB_HUB_SMOKE_SCENARIO, requests.requests, {
    scenario,
    url: page.url(),
    HubSessionSource: 'stubbed-hub-session',
    WebReplayObserved: true,
    RealExecutionSource: 'none',
    hubEndpoints: Array.from(requests.endpoints).sort(),
    screenshot: path.relative(process.cwd(), screenshotPath).replace(/\\/g, '/'),
  });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
