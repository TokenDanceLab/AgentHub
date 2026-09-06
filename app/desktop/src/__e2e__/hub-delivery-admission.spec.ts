import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

// Exercise the normal App -> DesktopHubTaskBridge -> useHubIntegration path.
// Only HTTP/WS boundaries are fixtures: no real token, Hub, Edge or model is used.
// Like oidc-login.spec.ts, CSP bypass lets the reserved .invalid Hub reach routing.
test.use({ bypassCSP: true, viewport: { width: 1440, height: 810 } });

const DEVICE = '00000000-0000-0000-0000-000000000123';
const TASK = 'task-delivery-fixture';
const RUN = 'run-delivery-fixture';
const DELIVERY = 'delivery-fixture';
const RELAY = 'relay-delivery-fixture';
const TARGET = 'target-delivery-fixture';
const THREAD = 'thread-delivery-fixture';
const EMPTY_LIST = { items: [], page: { hasMore: false } };
type FixtureCallbackOwner = 'edge' | 'desktop';

async function readTaskState(page: Page) {
  return page.evaluate(async () => {
    // Read the actual store; do not seed business state or replace the hook.
    const modulePath = '/src/stores/taskBridgeStore.ts';
    const { useTaskBridgeStore } = await import(/* @vite-ignore */ modulePath);
    const state = useTaskBridgeStore.getState();
    return {
      tasks: state.tasks.map((task: { taskId: string; status: string; runId?: string }) => ({
        taskId: task.taskId, status: task.status, runId: task.runId ?? null,
      })),
      runToTask: state.runToTask,
    };
  });
}

async function readTaskStateWithOwner(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/stores/taskBridgeStore.ts';
    const { useTaskBridgeStore } = await import(/* @vite-ignore */ modulePath);
    const state = useTaskBridgeStore.getState();
    return {
      tasks: state.tasks.map((task: { taskId: string; status: string; runId?: string; callbackOwner?: string }) => ({
        taskId: task.taskId, status: task.status, runId: task.runId ?? null, callbackOwner: task.callbackOwner ?? null,
      })),
      runToTask: state.runToTask,
    };
  });
}

async function readTaskError(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/stores/taskBridgeStore.ts';
    const { useTaskBridgeStore } = await import(/* @vite-ignore */ modulePath);
    const state = useTaskBridgeStore.getState();
    return state.tasks[0]?.error ?? null;
  });
}

async function installDispatchFixture(page: Page, baseURL: string, theme: 'light' | 'dark') {
  const appOrigin = new URL(baseURL).origin;
  const hubSockets = new Set<WebSocketRoute>();
  const edgeSockets = new Set<WebSocketRoute>();
  let edgeSeq = 0;
  const calls = {
    runs: [] as Record<string, unknown>[],
    streams: [] as Record<string, unknown>[],
    acks: [] as Record<string, unknown>[],
    relayAcks: [] as Record<string, unknown>[],
    done: [] as Record<string, unknown>[],
    fails: [] as Record<string, unknown>[],
    registered: 0,
    targetsRead: 0,
    rejection: { status: 503, code: 'delivery_busy' } as { status: number; code: string } | null,
    owner: 'desktop' as FixtureCallbackOwner,
    deduplicated: false,
    healthSupported: true,
    healthCalls: 0,
    pageErrors: [] as string[],
    unhandledWrites: [] as string[],
  };

  page.on('pageerror', (error) => calls.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('[ErrorBoundary]')) {
      calls.pageErrors.push(message.text());
    }
  });

  await page.addInitScript(({ device, color }) => {
    sessionStorage.setItem('agenthub_hub_token', 'fixture-not-a-real-access-token');
    localStorage.setItem('agenthub_token_source', 'tokendance');
    localStorage.setItem('agenthub_device_id', device);
    localStorage.setItem('agenthub_onboarding_seen', 'true');
    localStorage.setItem('agenthub-v4-theme', color);
    // Select the non-demo application path. Evidence remains fixture-only:
    // every Hub/Edge request is intercepted below, including WebSockets.
    localStorage.setItem('agenthub.workbench.dataMode', 'observed');
  }, { device: DEVICE, color: theme });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appOrigin && request.method() === 'GET' && !['fetch', 'xhr'].includes(request.resourceType())) {
      await route.continue();
      return;
    }
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    const list = () => json({ code: 'OK', data: EMPTY_LIST });
    if (url.origin === 'https://hub.test.invalid') {
      if (url.pathname === '/client/auth/me') {
        await json({ code: 'OK', data: { id: 'user-fixture', username: 'fixture', display_name: 'Fixture User' } });
      } else if (url.pathname === '/client/contacts' || url.pathname === '/client/sessions') {
        await json({ code: 'OK', data: [] });
      } else if (url.pathname === '/edge/devices:register' || url.pathname === '/edge/devices/register') {
        calls.registered++;
        await json({ code: 'OK', data: { id: DEVICE } });
      } else if (url.pathname === '/web/execution-targets') {
        calls.targetsRead++;
        await json({ code: 'OK', data: {
          items: [{ id: TARGET, name: 'Fixture Local Edge', device_id: DEVICE, target_type: 'local_edge', health_state: 'healthy', is_online: true }],
          page: { hasMore: false },
        } });
      } else if (url.pathname === '/edge/agent-tasks/' + TASK + '/ack') {
        calls.acks.push(request.postDataJSON());
        await json({ code: calls.acks.length === 1 ? 'ERROR' : 'OK' }, calls.acks.length === 1 ? 500 : 200);
      } else if (url.pathname === '/web/relay/commands/' + RELAY + '/device-ack') {
        calls.relayAcks.push(request.postDataJSON());
        await json({ code: calls.relayAcks.length === 1 ? 'ERROR' : 'OK' }, calls.relayAcks.length === 1 ? 500 : 200);
      } else if (url.pathname === '/edge/agent-tasks/' + TASK + '/done') {
        calls.done.push(request.postDataJSON());
        await json({ code: 'OK' });
      } else if (url.pathname === '/edge/agent-tasks/' + TASK + '/fail') {
        calls.fails.push(request.postDataJSON());
        await json({ code: 'OK' });
      } else if (url.pathname === '/edge/agent-tasks/' + TASK + '/stream') {
        calls.streams.push(request.postDataJSON());
        await json({ code: 'OK' });
      } else if (request.method() === 'GET') {
        await list();
      } else {
        calls.unhandledWrites.push(request.method() + ' ' + url.pathname);
        await route.abort();
      }
      return;
    }
    if (url.origin === 'http://127.0.0.1:3210') {
      if (url.pathname === '/v1/health') {
        calls.healthCalls++;
        await json({ code: 'OK', data: {
          status: 'ok', version: 'fixture', edgeId: 'edge-fixture',
          capabilities: calls.healthSupported
            ? { runCallbackOwnership: true, directHubCallbacks: false }
            : { directHubCallbacks: true },
        } });
      } else if (url.pathname === '/v1/model-catalog') {
        await json({ code: 'OK', data: { items: [], sources: [] } });
      } else if (url.pathname === '/v1/threads' && request.method() === 'POST') {
        await json({ code: 'OK', data: { threadId: THREAD, projectId: 'proj_local' } }, 201);
      } else if (url.pathname === '/v1/runs' && request.method() === 'POST') {
        calls.runs.push(request.postDataJSON());
        if (calls.rejection) {
          await route.fulfill({ status: calls.rejection.status, headers: calls.rejection.status === 503 ? { 'Retry-After': '1' } : {}, json: {
            error: { code: calls.rejection.code, message: 'fixture admission rejection: ' + calls.rejection.code, traceId: 'fixture-trace' },
          } });
        } else {
          await json({ code: 'OK', data: { runId: RUN, projectId: 'proj_local', threadId: THREAD, status: 'queued', deduplicated: calls.deduplicated, deliveryId: DELIVERY, callbackOwner: calls.owner } }, 202);
        }
      } else if (request.method() === 'GET') {
        await list();
      } else {
        calls.unhandledWrites.push(request.method() + ' ' + url.pathname);
        await route.abort();
      }
      return;
    }
    // Unknown APIs, font CDNs and any live host fail closed; no fallback network.
    await route.abort();
  });

  await page.routeWebSocket('**', (socket) => {
    const url = new URL(socket.url());
    if (url.host === new URL(appOrigin).host) {
      socket.connectToServer(); // Vite HMR only, on the task's own renderer server.
    } else if (url.hostname === 'hub.test.invalid' && url.pathname === '/client/ws') {
      hubSockets.add(socket);
      socket.onClose(() => hubSockets.delete(socket));
      socket.send(JSON.stringify({ type: 'auth.ok', payload: null }));
    } else if (url.origin === 'ws://127.0.0.1:3210' && url.pathname === '/v1/events') {
      edgeSockets.add(socket);
      socket.onClose(() => edgeSockets.delete(socket));
    } else {
      socket.close();
    }
  });

  await page.goto('/');
  await expect(page.getByTestId('agenthub-workbench')).toBeVisible();
  await expect.poll(() => calls.registered).toBeGreaterThan(0);
  await expect.poll(() => calls.targetsRead).toBeGreaterThan(0);
  await expect.poll(() => hubSockets.size).toBeGreaterThan(0);
  await expect.poll(() => edgeSockets.size).toBeGreaterThan(0);
  // Wait for the target query's React effects before sending the first frame.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  return {
    calls,
    async dispatch(waitForRun = true) {
      const response = waitForRun
        ? page.waitForResponse((result) =>
            result.url() === 'http://127.0.0.1:3210/v1/runs' && result.request().method() === 'POST',
          )
        : null;
      const frame = { type: 'agent.dispatch', payload: {
        relay_command_id: RELAY, command_type: 'agent.dispatch', payload: JSON.stringify({
          task_id: TASK, delivery_id: DELIVERY, prompt: 'Implement the requested fixture.',
          thread_id: THREAD, agent_type: 'codex', target_id: TARGET, edge_device_id: DEVICE,
          system_prompt: 'Use the approved project conventions.',
          tool_whitelist: '["Read","Grep"]',
          model_params: JSON.stringify({
            model: 'gpt-5.5',
            reasoning_effort: 'high',
            thinking_mode: 'adaptive',
            permission_mode: 'plan',
            work_dir: '/workspace/project',
            include_partial: true,
            max_thinking_tokens: 4096,
            append_system_prompt: 'Keep output concise.',
            config_overrides: { reasoning_summary: 'auto' },
            ephemeral: true,
            session_id: 'runtime-session-e2e',
            continue: false,
            fork: true,
            structured_output_schema: {
              type: 'object',
              properties: { result: { type: 'string' } },
              required: ['result'],
            },
          }),
          messages: [
            { role: 'user', content: 'Keep the change offline and preserve existing behavior.', timestamp: '2026-01-01T00:00:00Z' },
            { role: 'assistant', content: 'The earlier patch uses a bounded retry policy.', timestamp: '2026-01-01T00:01:00Z' },
          ],
          pinned_messages: [
            { role: 'system', content: 'Run focused tests before reporting success.', timestamp: '2026-01-01T00:00:00Z' },
          ],
          structured_output_schema: { type: 'array' },
          trace_id: 'trace-e2e',
        }),
      } };
      for (const socket of hubSockets) socket.send(JSON.stringify(frame));
      if (response) await (await response).finished();
      // Negative assertions must wait until the error body and React effects
      // have been consumed, not just until the mock records the request.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    },
    sendEdge(type: string, payload: Record<string, unknown>) {
      edgeSeq += 1;
      for (const socket of edgeSockets) {
        socket.send(JSON.stringify({ version: 'v1', id: 'fixture-' + type + '-' + edgeSeq, seq: edgeSeq, type, ts: new Date().toISOString(), scope: { runId: RUN, threadId: THREAD }, payload }));
      }
    },
    finish() {
      edgeSeq += 1;
      for (const socket of edgeSockets) {
        socket.send(JSON.stringify({ version: 'v1', id: 'fixture-finished-' + edgeSeq, seq: edgeSeq, type: 'run.finished', ts: new Date().toISOString(), scope: { runId: RUN, threadId: THREAD }, payload: { runId: RUN } }));
      }
    },
  };
}

for (const theme of ['light', 'dark'] as const) {
  test('actual Desktop bridge retries admission and repairs lost ACKs (' + theme + ')', async ({ page, baseURL }, testInfo) => {
    if (!baseURL) throw new Error('Desktop E2E baseURL is required');
    const { calls, dispatch, finish } = await installDispatchFixture(page, baseURL, theme);
    const queued = { tasks: [{ taskId: TASK, status: 'queued', runId: null }], runToTask: {} };

    await dispatch();
    await expect.poll(() => calls.runs.length).toBe(1);
    await expect.poll(() => readTaskState(page)).toEqual(queued);
    expect(calls.runs[0]).toMatchObject({ deliveryId: DELIVERY, hubTaskId: TASK, targetId: TARGET, edgeDeviceId: DEVICE });
    expect(calls.acks).toHaveLength(0);
    expect(calls.relayAcks).toHaveLength(0);
    expect(calls.fails).toHaveLength(0);

    calls.rejection = { status: 429, code: 'too_many_concurrent_runs' };
    await dispatch();
    await expect.poll(() => calls.runs.length).toBe(2);
    await expect.poll(() => readTaskState(page)).toEqual(queued);
    expect(calls.acks).toHaveLength(0);
    expect(calls.relayAcks).toHaveLength(0);
    expect(calls.fails).toHaveLength(0);

    calls.rejection = { status: 503, code: 'admission_persist_failed' };
    await dispatch();
    await expect.poll(() => calls.runs.length).toBe(3);
    await expect.poll(() => readTaskState(page)).toEqual(queued);
    expect(calls.acks).toHaveLength(0);
    expect(calls.relayAcks).toHaveLength(0);
    expect(calls.fails).toHaveLength(0);

    // admission_uncertain is human-review territory: queued, no ACK/FAIL/relay-ACK.
    calls.rejection = { status: 409, code: 'admission_uncertain' };
    await dispatch();
    await expect.poll(() => calls.runs.length).toBe(4);
    await expect.poll(() => readTaskState(page)).toEqual(queued);
    await expect.poll(() => readTaskError(page)).toContain('fixture admission rejection: admission_uncertain');
    const reviewNotice = page.getByText(/Edge admission result is uncertain.*fixture admission rejection: admission_uncertain/);
    await expect(reviewNotice).toBeVisible();
    await expect(reviewNotice).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('admission-uncertain-' + theme + '.png') });
    expect(calls.acks).toHaveLength(0);
    expect(calls.relayAcks).toHaveLength(0);
    expect(calls.fails).toHaveLength(0);

    // The test drives the next dispatch after manual review; this is not an
    // automatic client-side retry and the hook itself does not start one.
    calls.rejection = null;
    await dispatch();
    await expect.poll(() => calls.runs.length).toBe(5);
    await expect.poll(() => calls.acks.length).toBe(1);
    await expect.poll(() => calls.relayAcks.length).toBe(1);
    await expect.poll(() => readTaskState(page)).toEqual({ tasks: [{ taskId: TASK, status: 'running', runId: RUN }], runToTask: { [RUN]: TASK } });
    await expect.poll(() => readTaskError(page)).toBeNull();

    // Both first ACK requests failed. A successful replay must send them again.
    await dispatch();
    await expect.poll(() => calls.acks.length).toBe(2);
    await expect.poll(() => calls.relayAcks.length).toBe(2);
    expect(calls.acks).toEqual([{ run_id: RUN }, { run_id: RUN }]);
    expect(calls.runs).toHaveLength(6);
    expect(calls.fails).toHaveLength(0);

    finish();
    await expect.poll(() => calls.done.length).toBe(1);
    const finished = { tasks: [{ taskId: TASK, status: 'done', runId: RUN }], runToTask: { [RUN]: TASK } };
    await expect.poll(() => readTaskState(page)).toEqual(finished);
    await dispatch();
    await expect.poll(() => calls.acks.length).toBe(3);
    await expect.poll(() => calls.relayAcks.length).toBe(3);
    await expect.poll(() => readTaskState(page)).toEqual(finished);
    expect(calls.done).toHaveLength(1);

    calls.rejection = { status: 500, code: 'internal_error' };
    await dispatch();
    await expect.poll(() => calls.runs.length).toBe(8);
    await expect.poll(() => readTaskState(page)).toEqual(finished);
    expect(calls.fails).toHaveLength(0);
    expect(calls.acks).toHaveLength(3);
    expect(calls.pageErrors).toEqual([]);
    expect(calls.unhandledWrites).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('delivery-admission-' + theme + '.png') });
  });
}

for (const theme of ['light', 'dark'] as const) {
  test('Desktop bridge delivers full execution intent and keeps edge-owned replay local (' + theme + ')', async ({ page, baseURL }) => {
    if (!baseURL) throw new Error('Desktop E2E baseURL is required');
    const { calls, dispatch, sendEdge, finish } = await installDispatchFixture(page, baseURL, theme);
    calls.rejection = null;
    calls.owner = 'edge';
    calls.deduplicated = true;

    await dispatch();
    await expect.poll(() => calls.runs.length).toBe(1);
    const run = calls.runs[0];
    if (!run) throw new Error('fixture run request was not recorded');
    expect(run).toMatchObject({
      agentId: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      thinkingMode: 'adaptive',
      permissionMode: 'plan',
      workDir: '/workspace/project',
      includePartial: true,
      maxThinkingTokens: 4096,
      systemPrompt: 'Use the approved project conventions.',
      appendSystemPrompt: 'Keep output concise.',
      allowedTools: ['Read', 'Grep'],
      configOverrides: { reasoning_summary: 'auto' },
      ephemeral: true,
      sessionId: 'runtime-session-e2e',
      continue: false,
      fork: true,
      trace_id: 'trace-e2e',
      callbackOwner: 'desktop',
      hubTaskId: TASK,
      deliveryId: DELIVERY,
      targetId: TARGET,
      edgeDeviceId: DEVICE,
    });
    const schema = run.structuredOutputSchema;
    if (typeof schema !== 'string') throw new Error('fixture schema was not serialized to a string');
    expect(JSON.parse(schema)).toEqual({
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
    });
    expect(run.messages).toEqual([
      { role: 'user', content: 'Keep the change offline and preserve existing behavior.', timestamp: '2026-01-01T00:00:00Z' },
      { role: 'assistant', content: 'The earlier patch uses a bounded retry policy.', timestamp: '2026-01-01T00:01:00Z' },
    ]);
    expect(run.pinnedMessages).toEqual([
      { role: 'system', content: 'Run focused tests before reporting success.', timestamp: '2026-01-01T00:00:00Z' },
    ]);

    await expect.poll(() => readTaskStateWithOwner(page)).toEqual({
      tasks: [{ taskId: TASK, status: 'running', runId: RUN, callbackOwner: 'edge' }],
      runToTask: { [RUN]: TASK },
    });
    expect(calls.acks).toHaveLength(0);
    expect(calls.relayAcks).toHaveLength(1);
    expect(calls.streams).toHaveLength(0);
    expect(calls.done).toHaveLength(0);
    expect(calls.fails).toHaveLength(0);

    sendEdge('run.agent.text_delta', { runId: RUN, content: 'visible edge output' });
    finish();
    await expect.poll(() => readTaskStateWithOwner(page)).toEqual({
      tasks: [{ taskId: TASK, status: 'done', runId: RUN, callbackOwner: 'edge' }],
      runToTask: { [RUN]: TASK },
    });
    expect(calls.acks).toHaveLength(0);
    expect(calls.relayAcks).toHaveLength(1);
    expect(calls.streams).toHaveLength(0);
    expect(calls.done).toHaveLength(0);
    expect(calls.fails).toHaveLength(0);

    calls.owner = 'desktop';
    calls.deduplicated = true;
    await dispatch();
    await expect.poll(() => readTaskStateWithOwner(page)).toEqual({
      tasks: [{ taskId: TASK, status: 'done', runId: RUN, callbackOwner: 'edge' }],
      runToTask: { [RUN]: TASK },
    });
    expect(calls.acks).toHaveLength(0);
    expect(calls.relayAcks).toHaveLength(2);
    expect(calls.streams).toHaveLength(0);
    expect(calls.done).toHaveLength(0);
    expect(calls.fails).toHaveLength(0);
    expect(calls.pageErrors).toEqual([]);
    expect(calls.unhandledWrites).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test('Desktop bridge fails closed before POST on old Edge callback ownership (' + theme + ')', async ({ page, baseURL }) => {
    if (!baseURL) throw new Error('Desktop E2E baseURL is required');
    const { calls, dispatch } = await installDispatchFixture(page, baseURL, theme);
    calls.rejection = null;
    calls.healthSupported = false;

    await dispatch(false);
    await expect.poll(() => calls.healthCalls).toBeGreaterThan(0);
    await expect.poll(() => readTaskStateWithOwner(page)).toEqual({
      tasks: [{ taskId: TASK, status: 'queued', runId: null, callbackOwner: null }],
      runToTask: {},
    });
    await expect.poll(() => readTaskError(page)).toContain('runCallbackOwnership');
    expect(calls.runs).toHaveLength(0);
    expect(calls.acks).toHaveLength(0);
    expect(calls.relayAcks).toHaveLength(0);
    expect(calls.fails).toHaveLength(0);
    expect(calls.streams).toHaveLength(0);
    expect(calls.pageErrors).toEqual([]);
    expect(calls.unhandledWrites).toEqual([]);
  });
}
