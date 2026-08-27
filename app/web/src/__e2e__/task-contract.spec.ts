import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildE2EDataModeManifest,
  createE2EDataModeScenario,
  type E2EObservedRequest,
} from '../../../shared/src/testing/e2eDataModeContract';

const ARTIFACT_DIR = path.resolve(process.cwd(), '.tmp', 'task-contract-replay');
// Must match playwright.config.ts webServer VITE_HUB_URL: the fail-closed
// reserved origin keeps every Hub call inside the route stub instead of
// reaching localhost or production.
const HUB_ORIGIN = 'https://hub.test.invalid';
const WEB_E2E_PORT = Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5174);
const WEB_E2E_APP_ORIGIN = `http://127.0.0.1:${WEB_E2E_PORT}`;
const WEB_TASK_CONTRACT_SCENARIO = createE2EDataModeScenario({
  name: 'web-task-contract-replay',
  surface: 'web',
  dataMode: 'approved-real',
  dataSource: 'stubbed-hub-session',
  appOrigin: WEB_E2E_APP_ORIGIN,
  hubOrigin: HUB_ORIGIN,
  mockAdapterUsed: true,
});

test.describe('Web Hub task approval/artifact contract', () => {
  test('consumes single-task approval and artifact endpoints from a stubbed Hub', async ({ page }) => {
    const requested: BackendRequestLog = {
      endpoints: new Set<string>(),
      requests: [],
    };

    // Fail-closed external boundary: this catch-all is registered first, so
    // the Hub route below (routes match last-registered-first) still serves
    // the stubbed Hub origin. App requests continue to the dev server, the
    // render-blocking Google Fonts stylesheets get an empty stylesheet so the
    // document load event can fire, and every other external host is recorded
    // and refused — the manifest assertion then fails the test instead of an
    // unexpected remote call succeeding silently.
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === WEB_E2E_APP_ORIGIN) {
        return route.continue();
      }
      if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      }
      requested.requests.push({ method: request.method(), url: request.url() });
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'blocked_by_e2e_data_mode_contract' }),
        headers: { 'access-control-allow-origin': '*' },
      });
    });

    await page.route(`${HUB_ORIGIN}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      requested.endpoints.add(`${request.method()} ${url.pathname}`);
      requested.requests.push({ method: request.method(), url: request.url() });

      if (request.method() === 'OPTIONS') {
        return route.fulfill({ status: 204 });
      }

      if (url.pathname === '/client/auth/me') {
        return route.fulfill(json(hubEnvelope({
          id: 'user-web-contract',
          username: 'web-contract',
          nickname: 'Web Contract',
          avatar_url: '',
        })));
      }

      if (url.pathname === '/client/sessions') {
        return route.fulfill(json(hubEnvelope([{
          id: 'session-web-contract',
          type: 'group',
          name: 'Stubbed Hub task contract',
          member_count: 2,
        }])));
      }

      if (url.pathname === '/client/sessions/session-web-contract/messages') {
        return route.fulfill(json(hubEnvelope([
          {
            id: 'message-contract-queued',
            session_id: 'session-web-contract',
            seq_id: 1,
            client_msg_id: 'client-message-contract-queued',
            sender_type: 'user',
            sender_id: 'user-web-contract',
            content_type: 'text',
            content: {
              text: '@Reviewer Review the Hub-only task contract.',
              im_kind: 'project_group',
              mentions: [{ id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' }],
              agent_task: { task_id: 'task-web-contract', status: 'queued' },
            },
            created_at: '2026-06-09T01:00:00Z',
          },
          {
            id: 'message-contract-assigned',
            session_id: 'session-web-contract',
            seq_id: 2,
            client_msg_id: 'client-message-contract-assigned',
            sender_type: 'system',
            sender_id: 'hub-orchestrator',
            content_type: 'text',
            content: {
              text: 'Reviewer accepted task-web-contract.',
              im_kind: 'project_group',
              mentions: [{ id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' }],
              agent_task: { task_id: 'task-web-contract', status: 'assigned' },
            },
            created_at: '2026-06-09T01:00:01Z',
          },
          {
            id: 'message-contract-working',
            session_id: 'session-web-contract',
            seq_id: 3,
            client_msg_id: 'client-message-contract-working',
            sender_type: 'agent',
            sender_id: 'agent-reviewer',
            sender: { nickname: 'Reviewer' },
            content_type: 'text',
            content: {
              text: 'Reviewer is checking the Hub task contract.',
              im_kind: 'project_group',
              from_agent: { id: 'agent-reviewer', label: 'Reviewer' },
              mentions: [{ id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' }],
              agent_task: { task_id: 'task-web-contract', status: 'working' },
            },
            created_at: '2026-06-09T01:00:02Z',
          },
          {
            id: 'message-contract-done',
            session_id: 'session-web-contract',
            seq_id: 4,
            client_msg_id: 'client-message-contract-done',
            sender_type: 'agent',
            sender_id: 'agent-reviewer',
            sender: { nickname: 'Reviewer' },
            content_type: 'text',
            content: {
              text: 'Reviewer finished the Hub task contract check.',
              im_kind: 'project_group',
              from_agent: { id: 'agent-reviewer', label: 'Reviewer' },
              mentions: [{ id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' }],
              agent_task: { task_id: 'task-web-contract', status: 'done' },
            },
            created_at: '2026-06-09T01:00:03Z',
          },
        ])));
      }

      if (url.pathname === '/client/sessions/session-web-contract/pins') {
        return route.fulfill(json(hubEnvelope([])));
      }

      if (url.pathname === '/client/contacts' || url.pathname === '/client/notifications') {
        return route.fulfill(json(hubEnvelope([])));
      }

      if (url.pathname === '/web/agent-profiles') {
        return route.fulfill(json(hubEnvelope({
          items: [],
          page: { hasMore: false },
        })));
      }

      if (url.pathname === '/web/projects') {
        return route.fulfill(json(hubEnvelope({
          items: [],
          page: { hasMore: false },
        })));
      }

      if (url.pathname === '/web/execution-targets') {
        return route.fulfill(json(hubEnvelope({
          items: [{
            id: 'target-local-edge-contract',
            name: 'Contract Desktop Edge',
            target_type: 'local_edge',
            workspace_allowlist: [],
            trust_level: 'local',
            health_state: 'healthy',
            is_online: true,
          }],
          page: { hasMore: false },
        })));
      }

      if (url.pathname === '/web/agent-tasks/task-web-contract/events') {
        return route.fulfill(json(hubEnvelope([])));
      }

      if (url.pathname === '/web/agent-tasks/task-web-contract/events/summary') {
        return route.fulfill(json(hubEnvelope({
          task_id: 'task-web-contract',
          edge_run_id: 'edge-run-contract',
          status: 'running',
          total_events: 2,
          last_event_seq: 6,
          event_type_counts: {},
          tool_call_count: 0,
          step_count: 0,
          artifact_count: 1,
          approval_count: 1,
          pending_approvals: 1,
          decided_approvals: 0,
          input_tokens: 0,
          output_tokens: 0,
          output_bytes: 0,
        })));
      }

      if (url.pathname === '/web/agent-tasks/task-web-contract/approvals') {
        return route.fulfill(json(hubEnvelope({
          task_id: 'task-web-contract',
          edge_run_id: 'edge-run-contract',
          session_id: 'session-web-contract',
          approvals: [{
            approval_id: 'approval-contract-1',
            task_id: 'task-web-contract',
            edge_run_id: 'edge-run-contract',
            session_id: 'session-web-contract',
            source_event_id: 'evt-approval-contract-1',
            event_seq: 5,
            request_id: 'perm-contract-1',
            tool_name: 'Write',
            status: 'pending',
            reason: 'Stubbed Hub approval endpoint',
            created_at: '2026-06-09T01:00:02Z',
          }],
          pending: [],
          decided: [],
          last_event_seq: 5,
        })));
      }

      if (url.pathname === '/web/agent-tasks/task-web-contract/artifacts') {
        return route.fulfill(json(hubEnvelope({
          task_id: 'task-web-contract',
          edge_run_id: 'edge-run-contract',
          session_id: 'session-web-contract',
          artifacts: [{
            task_id: 'task-web-contract',
            edge_run_id: 'edge-run-contract',
            session_id: 'session-web-contract',
            source_event_id: 'evt-artifact-contract-1',
            event_seq: 6,
            artifact_id: 'artifact-contract-1',
            path: 'reports/contract-smoke.md',
            action: 'created',
            tool_name: 'Write',
            mime_type: 'text/markdown',
            size_bytes: 256,
            created_at: '2026-06-09T01:00:03Z',
          }],
          last_event_seq: 6,
        })));
      }

      return route.fulfill(json(hubEnvelope({})));
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('agenthub.workbench.dataMode', 'approved-real');
      window.localStorage.setItem('agenthub.web.activeAgentTask.session-web-contract', JSON.stringify({
        taskId: 'task-web-contract',
        sessionId: 'session-web-contract',
        status: 'running',
      }));
      window.sessionStorage.setItem('agenthub_hub_token', 'stubbed-hub-token');
      window.sessionStorage.setItem('agenthub_hub_user', JSON.stringify({
        userId: 'user-web-contract',
        username: 'web-contract',
      }));
    });

    await page.goto('/');

    await expect(page.getByText('@Agent queued')).toBeVisible();
    await expect(page.getByText('@Agent done')).toBeVisible();
    await expect.poll(() => requested.endpoints.has('GET /web/agent-tasks/task-web-contract/approvals')).toBe(true);
    await expect.poll(() => requested.endpoints.has('GET /web/agent-tasks/task-web-contract/artifacts')).toBe(true);
    // Waiting approval cards auto-expand (RowItem), so the reason from the
    // stubbed approvals endpoint renders without a toggle.
    await expect(page.getByText('Stubbed Hub approval endpoint')).toBeVisible();
    // F10 (#1992): artifact rows are preview triggers, not expandable rows —
    // clicking one focuses the engineering Preview on that exact artifact.
    const transcript = page.getByRole('region', { name: 'Transcript' });
    await transcript.getByRole('button', { name: /reports\/contract-smoke\.md/ }).click();
    await expect(page.getByRole('region', { name: 'reports/contract-smoke.md read-only preview' })).toBeVisible();
    // F5 (#1994): the global status bar surfaces the real pending-approval
    // count from the stubbed Hub approvals endpoint.
    await expect(page.getByRole('button', { name: /1 awaiting approval/ })).toBeVisible();
    await expect(page.getByText('reports/contract-smoke.md').first()).toBeVisible();

    writeReplayManifest(requested);
  });
});

interface BackendRequestLog {
  endpoints: Set<string>;
  requests: E2EObservedRequest[];
}

function hubEnvelope<T>(data: T): { code: string; data: T } {
  return { code: 'ok', data };
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
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    },
  };
}

function writeReplayManifest(requested: BackendRequestLog): void {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const requestedEndpoints = Array.from(requested.endpoints).sort();
  const manifest = buildE2EDataModeManifest(WEB_TASK_CONTRACT_SCENARIO, requested.requests, {
    taskId: 'task-web-contract',
    sessionId: 'session-web-contract',
    approvalReplayObserved: requestedEndpoints.includes('GET /web/agent-tasks/task-web-contract/approvals'),
    artifactReplayObserved: requestedEndpoints.includes('GET /web/agent-tasks/task-web-contract/artifacts'),
    summaryReplayObserved: requestedEndpoints.includes('GET /web/agent-tasks/task-web-contract/events/summary'),
    HubSessionSource: 'stubbed-hub-session',
    WebReplayObserved: true,
    RealExecutionSource: 'none',
    realTokenDanceIdLogin: false,
    hubEndpoints: requestedEndpoints,
  });
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'task-contract-replay.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
