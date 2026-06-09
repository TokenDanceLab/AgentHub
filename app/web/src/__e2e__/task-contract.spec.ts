import { expect, test } from '@playwright/test';

test.describe('Web Hub task approval/artifact contract', () => {
  test('consumes single-task approval and artifact endpoints from a stubbed Hub', async ({ page }) => {
    const requested = new Set<string>();

    await page.route('http://localhost:8080/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      requested.add(`${request.method()} ${url.pathname}`);

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
          name: 'Real Hub task contract',
          member_count: 2,
        }])));
      }

      if (url.pathname === '/client/sessions/session-web-contract/messages') {
        return route.fulfill(json(hubEnvelope([{
          id: 'message-contract-1',
          session_id: 'session-web-contract',
          seq_id: 1,
          client_msg_id: 'client-message-contract-1',
          sender_type: 'user',
          sender_id: 'user-web-contract',
          content_type: 'text',
          content: 'Review the Hub-only task contract.',
          created_at: '2026-06-09T01:00:00Z',
        }])));
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

      if (url.pathname === '/web/agent-tasks/task-web-contract/summary') {
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

    await expect(page.getByText('Stubbed Hub approval endpoint')).toBeVisible();
    await expect(page.getByText('reports/contract-smoke.md').first()).toBeVisible();
    await expect.poll(() => requested.has('GET /web/agent-tasks/task-web-contract/approvals')).toBe(true);
    await expect.poll(() => requested.has('GET /web/agent-tasks/task-web-contract/artifacts')).toBe(true);
  });
});

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
