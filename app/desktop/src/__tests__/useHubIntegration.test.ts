// Edge event stream mock — provides a controlled StreamHandle for test firing.
import type { StreamHandle } from '@/api/eventClient';
import type { EventEnvelope } from '@shared/events';

// Use vi.hoisted so mock factories can reference these without hoisting issues.
const hoisted = vi.hoisted(() => {
  // Edge event handlers
  let edgeHandlers: Set<(event: EventEnvelope) => void> = new Set();
  let mockStream: StreamHandle | null = null;

  // Store state
  let storeTasks: import('@/stores/taskBridgeStore').AgentTask[] = [];
  let storeRunToTask: Record<string, string> = {};

  const resetStore = () => {
    storeTasks = [];
    storeRunToTask = {};
  };

  const getStoreState = () => ({
    tasks: storeTasks,
    runToTask: storeRunToTask,
    getTaskByRunId: (runId: string) => {
      const taskId = storeRunToTask[runId];
      return taskId ? storeTasks.find((t) => t.taskId === taskId) : undefined;
    },
    getRunByTaskId: (taskId: string) => {
      const task = storeTasks.find((t) => t.taskId === taskId);
      return task?.runId;
    },
    addTask: (task: import('@/stores/taskBridgeStore').AgentTask) => {
      if (!storeTasks.some((t) => t.taskId === task.taskId)) {
        storeTasks = [...storeTasks, task];
        if (task.runId) {
          storeRunToTask = { ...storeRunToTask, [task.runId]: task.taskId };
        }
      }
    },
    updateTask: (
      taskId: string,
      updates: Partial<import('@/stores/taskBridgeStore').AgentTask>,
    ) => {
      storeTasks = storeTasks.map((t) => {
        if (t.taskId !== taskId) return t;
        const updated = { ...t, ...updates };
        return updated;
      });
      for (const t of storeTasks) {
        if (t.taskId === taskId && t.runId) {
          storeRunToTask = { ...storeRunToTask, [t.runId]: taskId };
        }
      }
    },
    removeTask: (taskId: string) => {
      const task = storeTasks.find((t) => t.taskId === taskId);
      storeTasks = storeTasks.filter((t) => t.taskId !== taskId);
      if (task?.runId) {
        storeRunToTask = Object.fromEntries(
          Object.entries(storeRunToTask).filter(([runId]) => runId !== task.runId),
        );
      }
    },
    getActiveTasks: () => storeTasks.filter((t) => t.status === 'queued' || t.status === 'running'),
    clear: () => {
      storeTasks = [];
      storeRunToTask = {};
    },
  });

  return {
    get edgeHandlers() {
      return edgeHandlers;
    },
    set edgeHandlers(v: Set<(event: EventEnvelope) => void>) {
      edgeHandlers = v;
    },
    get mockStream() {
      return mockStream;
    },
    set mockStream(v: StreamHandle | null) {
      mockStream = v;
    },
    get storeTasks() {
      return storeTasks;
    },
    get storeRunToTask() {
      return storeRunToTask;
    },
    resetStore,
    getStoreState,
  };
});

vi.mock('@/api/eventClient', () => ({
  createEventStream: vi.fn(() => hoisted.mockStream),
}));

vi.mock('@/stores/taskBridgeStore', () => {
  const getState = vi.fn(() => hoisted.getStoreState());

  const useStore = Object.assign(
    vi.fn((selector: (s: ReturnType<typeof hoisted.getStoreState>) => unknown) =>
      selector(getState()),
    ),
    { getState },
  );

  return {
    useTaskBridgeStore: useStore,
  };
});

// ── Imports after mocks ─────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createServer, type IncomingMessage } from 'node:http';
import type { HubWSHandle } from '@shared/hub/hubWS';
import type { HubClient } from '@/api/hubClient';
import { HUB_EVENTS } from '@shared/hubEvents';
import { useHubIntegration } from '@/hooks/useHubIntegration';

// ── Helpers ─────────────────────────────────────────────

function makeEvent(type: string, payload: Record<string, unknown> = {}): EventEnvelope {
  return {
    version: 'v1',
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    seq: 1,
    type,
    scope: {},
    sentAt: new Date().toISOString(),
    payload,
  };
}

function makeDispatchPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_id: 'task-1',
    agent_instance_id: 'ai-1',
    agent_type: 'claude-code',
    session_id: 'sess-1',
    trigger_message_id: 'msg-1',
    trigger_user_id: 'user-1',
    display_name: 'Claude',
    prompt: 'Do something',
    ...overrides,
  };
}

type HubEventHandler = (payload: unknown) => void;
const HUB_AGENT_CONTROL_EVENT = 'agent.control';
const nativeFetch = globalThis.fetch.bind(globalThis);

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

describe('useHubIntegration', () => {
  let hubWS: HubWSHandle;
  let hubClient: HubClient;
  let hubHandlers: Map<string, Set<HubEventHandler>>;

  // Mock fetch for Edge REST calls
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.resetStore();
    hoisted.edgeHandlers = new Set();
    hoisted.mockStream = {
      subscribe: vi.fn((handler: (event: EventEnvelope) => void) => {
        hoisted.edgeHandlers.add(handler);
        return () => {
          hoisted.edgeHandlers.delete(handler);
        };
      }),
      onStatusChange: vi.fn(() => () => {}),
      send: vi.fn(),
      getLatency: vi.fn(() => null),
      close: vi.fn(),
    } as unknown as StreamHandle;

    hubHandlers = new Map();

    // Mock Hub WS
    hubWS = {
      connect: vi.fn(),
      send: vi.fn(),
      sendTyping: vi.fn(),
      close: vi.fn(),
      reconnect: vi.fn(),
      getStatus: vi.fn(() => 'connected'),
      on: vi.fn((type: string, handler: HubEventHandler) => {
        if (!hubHandlers.has(type)) hubHandlers.set(type, new Set());
        hubHandlers.get(type)!.add(handler);
        return () => hubHandlers.get(type)?.delete(handler);
      }),
      onAny: vi.fn(() => () => {}),
      onStatus: vi.fn(() => () => {}),
    } as unknown as HubWSHandle;

    // Mock Hub Client
    hubClient = {
      request: vi.fn(),
      registerDevice: vi.fn().mockResolvedValue({ id: 'dev-1' }),
      ackTask: vi.fn().mockResolvedValue(undefined),
      ackRelayCommand: vi.fn().mockResolvedValue(undefined),
      streamTask: vi.fn().mockResolvedValue(undefined),
      streamTaskEvent: vi.fn().mockResolvedValue(undefined),
      doneTask: vi.fn().mockResolvedValue(undefined),
      failTask: vi.fn().mockResolvedValue(undefined),
      postTeamRouteDecision: vi.fn().mockResolvedValue({ id: 'assignment-1' }),
    } as unknown as HubClient;

    // Mock fetch for Edge REST calls
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'run-1',
          runId: 'run-1',
          projectId: 'proj-1',
          threadId: 'sess-1',
          status: 'started',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  function fireHubEvent(type: string, payload: unknown) {
    const handlers = hubHandlers.get(type);
    if (handlers) {
      for (const fn of handlers) {
        fn(payload);
      }
    }
  }

  function fireEdgeEvent(event: EventEnvelope) {
    for (const fn of hoisted.edgeHandlers) {
      fn(event);
    }
  }

  function fetchCallEndingWith(path: string) {
    const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith(path));
    if (!call) {
      throw new Error(`fetch call ending with ${path} not found`);
    }
    return call;
  }

  function fetchBodyFor(path: string) {
    const [, init] = fetchCallEndingWith(path);
    return JSON.parse(String((init as RequestInit).body));
  }

  function fetchCallCountEndingWith(path: string) {
    return fetchMock.mock.calls.filter(([input]) => String(input).endsWith(path)).length;
  }

  function mockRunSequence(...runIds: string[]) {
    const queue = [...runIds];
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/threads')) {
        return new Response(JSON.stringify({ threadId: 'thread-ok' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/v1/runs')) {
        const runId = queue.shift() ?? 'run-1';
        return new Response(
          JSON.stringify({
            id: runId,
            runId,
            projectId: 'proj',
            threadId: 'sess',
            status: 'started',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  }

  function mockRunCreateResponse(body: Record<string, unknown>) {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/threads')) {
        return new Response(JSON.stringify({ threadId: 'thread-ok' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/v1/runs')) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  }

  function mockRunCreateResponseWithStatus(body: Record<string, unknown>, status: number) {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/threads')) {
        return new Response(JSON.stringify({ threadId: 'thread-ok' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/v1/runs')) {
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  }

  // ── agent.dispatch → Edge run ──────────────────────────

  it('acks task and starts Edge run on agent.dispatch', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    const dp = makeDispatchPayload();
    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, dp);
    });

    expect(hubClient.ackTask).toHaveBeenCalledWith('task-1', 'run-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/v1/runs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const threadBody = fetchBodyFor('/v1/threads');
    expect(threadBody.threadId).toBe('sess-1');
    expect(threadBody.projectId).toBe('proj_local');
    const fetchBody = fetchBodyFor('/v1/runs');
    expect(fetchBody.threadId).toBe('sess-1');
    expect(fetchBody.agentId).toBe('claude-code');
  });

  it('unwraps unified Edge run envelopes before acking Hub tasks', async () => {
    mockRunCreateResponse({
      code: 'OK',
      data: {
        id: 'run-envelope-1',
        projectId: 'proj-1',
        threadId: 'sess-1',
        status: 'started',
      },
    });
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    expect(hubClient.ackTask).toHaveBeenCalledWith('task-1', 'run-envelope-1');
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('keeps legacy raw Edge run responses compatible', async () => {
    mockRunCreateResponse({
      id: 'run-legacy-1',
      runId: 'run-legacy-1',
      projectId: 'proj-1',
      threadId: 'sess-1',
      status: 'started',
    });
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    expect(hubClient.ackTask).toHaveBeenCalledWith('task-1', 'run-legacy-1');
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('fails clearly when a unified Edge run envelope has no id or runId in data', async () => {
    mockRunCreateResponse({
      code: 'OK',
      data: {
        projectId: 'proj-1',
        threadId: 'sess-1',
        status: 'started',
      },
    });
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    expect(hubClient.ackTask).not.toHaveBeenCalled();
    expect(hubClient.failTask).toHaveBeenCalledWith(
      'task-1',
      'Edge run created but no id/runId in response data',
    );
  });

  it('refuses to hand off dispatches that are not targeted to this Desktop local edge', async () => {
    renderHook(() =>
      useHubIntegration({
        hubWS,
        hubClient,
        dispatchTarget: {
          targetId: 'target-current',
          deviceId: 'desktop-current',
        },
      }),
    );

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({
          target_id: 'target-other',
          edge_device_id: 'desktop-current',
        }),
      );
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({
          task_id: 'task-missing-target',
          edge_device_id: 'desktop-current',
        }),
      );
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({
          task_id: 'task-missing-device',
          target_id: 'target-current',
        }),
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hubClient.ackTask).not.toHaveBeenCalled();
    expect(hubClient.failTask).toHaveBeenCalledWith(
      'task-1',
      'Dispatch target mismatch: expected target-current for device desktop-current',
    );
    expect(hubClient.failTask).toHaveBeenCalledWith(
      'task-missing-target',
      'Dispatch target mismatch: expected target-current for device desktop-current',
    );
    expect(hubClient.failTask).toHaveBeenCalledWith(
      'task-missing-device',
      'Dispatch target mismatch: expected target-current for device desktop-current',
    );
  });

  it('hands matching target-bound dispatches to Local Edge', async () => {
    renderHook(() =>
      useHubIntegration({
        hubWS,
        hubClient,
        dispatchTarget: {
          targetId: 'target-current',
          deviceId: 'desktop-current',
        },
      }),
    );

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({
          target_id: 'target-current',
          edge_device_id: 'desktop-current',
        }),
      );
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/v1/threads',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/v1/runs',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(hubClient.ackTask).toHaveBeenCalledWith('task-1', 'run-1');
    expect(fetchBodyFor('/v1/runs')).toMatchObject({
      threadId: 'sess-1',
      agentId: 'claude-code',
      prompt: 'Do something',
      hubTaskId: 'task-1',
      targetId: 'target-current',
      edgeDeviceId: 'desktop-current',
      dispatchTargetEvidence: {
        expectedTargetId: 'target-current',
        observedTargetId: 'target-current',
        expectedEdgeDeviceId: 'desktop-current',
        observedEdgeDeviceId: 'desktop-current',
        targetStatus: 'matched',
      },
    });
    expect(hoisted.storeTasks[0]?.dispatchPayload).toMatchObject({
      target_id: 'target-current',
      edge_device_id: 'desktop-current',
      target_binding: {
        expected_target_id: 'target-current',
        observed_target_id: 'target-current',
        expected_edge_device_id: 'desktop-current',
        observed_edge_device_id: 'desktop-current',
        status: 'matched',
      },
    });
  });

  it('normalizes legacy Claude agent ids before starting Edge run', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload({ agent_type: 'claude' }));
    });

    const fetchBody = fetchBodyFor('/v1/runs');
    expect(fetchBody.agentId).toBe('claude-code');
  });

  it('passes Hub profile runtime config into Edge run request', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({
          agent_type: 'codex',
          system_prompt: 'You are a careful reviewer.',
          tool_whitelist: '["Read","Grep"]',
          model_params: JSON.stringify({
            model: 'gpt-5.5',
            reasoning_effort: 'high',
            thinking_mode: 'adaptive',
            permission_mode: 'plan',
            work_dir: 'D:\\Code\\TokenDance\\AgentHub',
            include_partial: true,
            max_thinking_tokens: 4096,
            append_system_prompt: 'Keep output concise.',
            config_overrides: { reasoning_summary: 'auto' },
            ephemeral: true,
          }),
        }),
      );
    });

    const fetchBody = fetchBodyFor('/v1/runs');
    expect(fetchBody).toMatchObject({
      agentId: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      thinkingMode: 'adaptive',
      permissionMode: 'plan',
      workDir: 'D:\\Code\\TokenDance\\AgentHub',
      includePartial: true,
      maxThinkingTokens: 4096,
      systemPrompt: 'You are a careful reviewer.',
      appendSystemPrompt: 'Keep output concise.',
      allowedTools: ['Read', 'Grep'],
      configOverrides: { reasoning_summary: 'auto' },
      ephemeral: true,
    });
  });

  it('maps taskId → runId and runId → taskId bidirectionally', async () => {
    const { result } = renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    expect(result.current.getRunByTaskId('task-1')).toBe('run-1');
    expect(result.current.getTaskByRunId('run-1')?.taskId).toBe('task-1');
  });

  it('reports failure to Hub when fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Edge unavailable'));

    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    expect(hubClient.failTask).toHaveBeenCalledWith('task-1', 'Edge unavailable');
  });

  it('ignores dispatch with missing task_id', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, { task_id: '', agent_type: '' });
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hubClient.ackTask).not.toHaveBeenCalled();
  });

  it('forwards Hub delivery_id into the Edge run body', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'delivery-snake' }),
      );
    });

    expect(fetchBodyFor('/v1/runs').deliveryId).toBe('delivery-snake');
  });

  it('forwards Hub deliveryId (camelCase) into the Edge run body', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ deliveryId: 'delivery-camel' }),
      );
    });

    expect(fetchBodyFor('/v1/runs').deliveryId).toBe('delivery-camel');
  });

  it('omits deliveryId from the Edge run body when no Hub delivery id is present (legacy)', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    const body = fetchBodyFor('/v1/runs');
    expect('deliveryId' in body).toBe(false);
  });

  it('duplicate dispatch keeps one run mapping, does not overwrite progress, and idempotently re-acks', async () => {
    mockRunSequence('run-1', 'run-1');
    const onDispatch = vi.fn();
    renderHook(() => useHubIntegration({ hubWS, hubClient, onDispatch }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });
    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');
    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(hubClient.ackTask).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');
    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(hoisted.storeRunToTask['run-1']).toBe('task-1');
    expect(hubClient.ackTask).toHaveBeenCalledTimes(2);
    expect(hubClient.failTask).not.toHaveBeenCalled();
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });

  it('does not downgrade a terminal task on a replayed dispatch, but re-acks idempotently', async () => {
    mockRunSequence('run-1');
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });
    act(() => {
      fireEdgeEvent(makeEvent('run.finished', { runId: 'run-1' }));
    });
    expect(hoisted.storeTasks[0]?.status).toBe('done');
    expect(hubClient.ackTask).toHaveBeenCalledTimes(1);

    mockRunSequence('run-1');
    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.status).toBe('done');
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');
    expect(hubClient.ackTask).toHaveBeenCalledTimes(2);
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('keeps a delivery_busy rejection queued without acking or failing', async () => {
    mockRunCreateResponseWithStatus({ error: { code: 'delivery_busy', message: 'busy', traceId: 'trace_001' } }, 503);
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.status).toBe('queued');
    expect(hoisted.storeTasks[0]?.runId).toBeUndefined();
    expect(hubClient.ackTask).not.toHaveBeenCalled();
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('keeps a too_many_concurrent_runs rejection queued without acking or failing', async () => {
    mockRunCreateResponseWithStatus({ error: { code: 'too_many_concurrent_runs', message: 'too many', traceId: 'trace_001' } }, 429);
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.status).toBe('queued');
    expect(hoisted.storeTasks[0]?.runId).toBeUndefined();
    expect(hubClient.ackTask).not.toHaveBeenCalled();
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('keeps an admission_persist_failed rejection queued without acking or failing', async () => {
    mockRunCreateResponseWithStatus({ error: { code: 'admission_persist_failed', message: 'persist failed', traceId: 'trace_001' } }, 503);
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.status).toBe('queued');
    expect(hoisted.storeTasks[0]?.runId).toBeUndefined();
    expect(hubClient.ackTask).not.toHaveBeenCalled();
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('keeps an admission_uncertain rejection queued for manual review without acking or failing', async () => {
    mockRunCreateResponseWithStatus({ error: { code: 'admission_uncertain', message: 'manual review', traceId: 'trace_001' } }, 409);
    renderHook(() =>
      useHubIntegration({
        hubWS,
        hubClient,
        dispatchTarget: { targetId: 'target-current', deviceId: 'desktop-current' },
      }),
    );

    const relayFrame = {
      relay_command_id: 'relay-1',
      command_type: 'agent.dispatch',
      payload: JSON.stringify(
        makeDispatchPayload({
          target_id: 'target-current',
          edge_device_id: 'desktop-current',
          delivery_id: 'd1',
        }),
      ),
    };
    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, relayFrame);
    });

    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.status).toBe('queued');
    expect(hoisted.storeTasks[0]?.runId).toBeUndefined();
    expect(hoisted.storeTasks[0]?.error).toContain('Edge admission result is uncertain');
    expect(hoisted.storeTasks[0]?.error).toContain('manual review');
    expect(hubClient.ackTask).not.toHaveBeenCalled();
    expect(hubClient.failTask).not.toHaveBeenCalled();
    expect(hubClient.ackRelayCommand).not.toHaveBeenCalled();
  });

  it('clears a queued admission_uncertain error when the same delivery is accepted', async () => {
    mockRunCreateResponseWithStatus({ error: { code: 'admission_uncertain', message: 'manual review', traceId: 'trace_001' } }, 409);
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });
    expect(hoisted.storeTasks[0]?.status).toBe('queued');
    expect(hoisted.storeTasks[0]?.error).toContain('manual review');

    mockRunSequence('run-1');
    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');
    expect(hoisted.storeTasks[0]?.error).toBeUndefined();
    expect(hubClient.ackTask).toHaveBeenCalledTimes(1);
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('keeps an existing active run on active_run_exists without acking or failing', async () => {
    mockRunSequence('run-1');
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });
    expect(hoisted.storeTasks[0]?.status).toBe('running');

    mockRunCreateResponseWithStatus({ error: { code: 'active_run_exists', message: 'active', traceId: 'trace_001' } }, 409);
    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');
    expect(hubClient.ackTask).toHaveBeenCalledTimes(1);
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('does not downgrade an already-running task on admission_uncertain', async () => {
    mockRunSequence('run-1');
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });
    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');

    mockRunCreateResponseWithStatus({ error: { code: 'admission_uncertain', message: 'manual review', traceId: 'trace_001' } }, 409);
    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');
    expect(hoisted.storeTasks[0]?.error).toBeUndefined();
    expect(hubClient.ackTask).toHaveBeenCalledTimes(1);
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('does not clear an existing error on a progressed successful replay', async () => {
    mockRunSequence('run-1');
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });
    hoisted.getStoreState().updateTask('task-1', { error: 'existing running error' });

    mockRunSequence('run-1');
    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');
    expect(hoisted.storeTasks[0]?.error).toBe('existing running error');
    expect(hubClient.ackTask).toHaveBeenCalledTimes(2);
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('does not ack a relay command on a delivery_busy rejection', async () => {
    mockRunCreateResponseWithStatus({ error: { code: 'delivery_busy', message: 'busy', traceId: 'trace_001' } }, 503);
    renderHook(() =>
      useHubIntegration({
        hubWS,
        hubClient,
        dispatchTarget: { targetId: 'target-current', deviceId: 'desktop-current' },
      }),
    );

    const relayFrame = {
      relay_command_id: 'relay-1',
      command_type: 'agent.dispatch',
      payload: JSON.stringify(
        makeDispatchPayload({
          target_id: 'target-current',
          edge_device_id: 'desktop-current',
          delivery_id: 'd1',
        }),
      ),
    };
    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, relayFrame);
    });

    expect(hubClient.ackRelayCommand).not.toHaveBeenCalled();
    expect(hubClient.ackTask).not.toHaveBeenCalled();
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('still fails a permanent Edge admission rejection (e.g. 500)', async () => {
    mockRunCreateResponseWithStatus({ error: { code: 'internal_error', message: 'boom', traceId: 'trace_001' } }, 500);
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks[0]?.status).toBe('failed');
    expect(hubClient.ackTask).not.toHaveBeenCalled();
    expect(hubClient.failTask).toHaveBeenCalled();
  });

  it('re-acks a successful replay when the first ACK was lost in transit', async () => {
    mockRunSequence('run-1', 'run-1');
    const ackTaskMock = hubClient.ackTask as ReturnType<typeof vi.fn>;
    ackTaskMock.mockRejectedValueOnce(new Error('ACK transport lost')).mockResolvedValue(undefined);

    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });
    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');
    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(ackTaskMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(ackTaskMock).toHaveBeenCalledTimes(2);
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');
    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('re-acks a relay command ACK on a successful replay when the first was lost', async () => {
    mockRunSequence('run-1', 'run-1');
    const relayAckMock = hubClient.ackRelayCommand as ReturnType<typeof vi.fn>;
    relayAckMock.mockRejectedValueOnce(new Error('relay ACK lost')).mockResolvedValue(undefined);

    renderHook(() =>
      useHubIntegration({
        hubWS,
        hubClient,
        dispatchTarget: { targetId: 'target-current', deviceId: 'desktop-current' },
      }),
    );

    const relayFrame = {
      relay_command_id: 'relay-1',
      command_type: 'agent.dispatch',
      payload: JSON.stringify(
        makeDispatchPayload({
          target_id: 'target-current',
          edge_device_id: 'desktop-current',
          delivery_id: 'd1',
        }),
      ),
    };
    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, relayFrame);
    });
    expect(relayAckMock).toHaveBeenCalledTimes(1);
    expect(hubClient.ackTask).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, relayFrame);
    });

    expect(relayAckMock).toHaveBeenCalledTimes(2);
    expect(hubClient.ackTask).toHaveBeenCalledTimes(2);
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  it('does not downgrade an already-running task when a duplicate delivery fails permanently', async () => {
    mockRunSequence('run-1');
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });
    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');

    mockRunCreateResponseWithStatus({ error: { code: 'internal_error', message: 'boom', traceId: 'trace_001' } }, 500);
    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ delivery_id: 'd1' }),
      );
    });

    expect(hoisted.storeTasks).toHaveLength(1);
    expect(hoisted.storeTasks[0]?.status).toBe('running');
    expect(hoisted.storeTasks[0]?.runId).toBe('run-1');
    expect(hubClient.failTask).not.toHaveBeenCalled();
  });

  // ── Edge events → Hub callbacks ──────────────────────

  it('streams text_delta to Hub', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    act(() => {
      fireEdgeEvent(makeEvent('run.agent.text_delta', { runId: 'run-1', content: 'Hello' }));
    });

    expect(hubClient.streamTaskEvent).toHaveBeenCalledWith(
      'task-1',
      'run.agent.text_delta',
      { runId: 'run-1', content: 'Hello' },
      { runId: 'run-1' },
    );
  });

  it('streams stdout run.output.batch to Hub and remembers it for final output', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    act(() => {
      fireEdgeEvent(
        makeEvent('run.output.batch', {
          runId: 'run-1',
          stream: 'stdout',
          chunks: [
            { offset: 0, text: 'stdout part 1\n' },
            { offset: 14, text: 'stdout part 2\n' },
          ],
        }),
      );
      fireEdgeEvent(makeEvent('run.finished', { runId: 'run-1', status: 'finished' }));
    });

    expect(hubClient.streamTaskEvent).toHaveBeenCalledWith(
      'task-1',
      'run.output.batch',
      {
        runId: 'run-1',
        stream: 'stdout',
        chunks: [
          { offset: 0, text: 'stdout part 1\n' },
          { offset: 14, text: 'stdout part 2\n' },
        ],
      },
      { runId: 'run-1' },
    );
    expect(hubClient.doneTask).toHaveBeenCalledWith(
      'task-1',
      'stdout part 1\nstdout part 2\n',
      'run-1',
    );
  });

  it('does not stream stderr run.output.batch to Hub', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    act(() => {
      fireEdgeEvent(
        makeEvent('run.output.batch', {
          runId: 'run-1',
          stream: 'stderr',
          chunks: [{ offset: 0, text: 'diagnostic only' }],
        }),
      );
    });

    expect(hubClient.streamTaskEvent).not.toHaveBeenCalled();
  });

  it('streams permission request and decision events to Hub', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    const requestPayload = {
      runId: 'run-1',
      requestId: 'perm-1',
      toolName: 'Bash',
      toolUseId: 'tool-1',
      command: 'pnpm test',
    };
    const decisionPayload = {
      runId: 'run-1',
      requestId: 'perm-1',
      decision: 'allow',
      reason: 'approved remotely',
    };

    act(() => {
      fireEdgeEvent(makeEvent('run.agent.permission_requested', requestPayload));
      fireEdgeEvent(makeEvent('run.agent.permission_decided', decisionPayload));
    });

    expect(hubClient.streamTaskEvent).toHaveBeenCalledWith(
      'task-1',
      'run.agent.permission_requested',
      requestPayload,
      { runId: 'run-1' },
    );
    expect(hubClient.streamTaskEvent).toHaveBeenCalledWith(
      'task-1',
      'run.agent.permission_decided',
      decisionPayload,
      { runId: 'run-1' },
    );
  });

  it('posts supervisor route decisions from typed Edge events to Hub TeamRun', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({
          team_id: 'team-1',
          team_run_id: 'team-run-1',
          team_member_id: 'member-supervisor',
          team_member_role: 'supervisor',
        }),
      );
    });

    act(() => {
      fireEdgeEvent(
        makeEvent('run.agent.route_decision', {
          runId: 'run-1',
          action: 'delegate',
          next_worker: 'member-executor',
          instructions: 'Implement the repository change.',
          reasoning: 'Backend work is needed.',
          correlation_id: 'route-1',
        }),
      );
    });

    expect(hubClient.postTeamRouteDecision).toHaveBeenCalledWith('team-1', 'team-run-1', {
      action: 'delegate',
      next_worker: 'member-executor',
      instructions: 'Implement the repository change.',
      reasoning: 'Backend work is needed.',
      context: undefined,
      approved: undefined,
      feedback: undefined,
      summary: undefined,
      blocked_reason: undefined,
      correlation_id: 'route-1',
    });
    expect(hubClient.streamTaskEvent).toHaveBeenCalledWith(
      'task-1',
      'run.agent.route_decision',
      {
        runId: 'run-1',
        action: 'delegate',
        next_worker: 'member-executor',
        instructions: 'Implement the repository change.',
        reasoning: 'Backend work is needed.',
        correlation_id: 'route-1',
      },
      { runId: 'run-1' },
    );
  });

  it('posts route decisions when TeamRun context is nested in model_params', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({
          model_params: JSON.stringify({
            agenthub_team_context: {
              team_id: 'team-nested',
              team_run_id: 'team-run-nested',
              team_member_role: 'supervisor',
            },
          }),
        }),
      );
    });

    act(() => {
      fireEdgeEvent(
        makeEvent('run.agent.route_decision', {
          runId: 'run-1',
          action: 'delegate',
          next_worker: 'member-executor',
          instructions: 'Continue from the nested team context.',
          correlation_id: 'route-nested',
        }),
      );
    });

    expect(hubClient.postTeamRouteDecision).toHaveBeenCalledWith('team-nested', 'team-run-nested', {
      action: 'delegate',
      next_worker: 'member-executor',
      instructions: 'Continue from the nested team context.',
      correlation_id: 'route-nested',
    });
  });

  it('posts structuredOutput route decisions from result only once', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({
          team_id: 'team-1',
          team_run_id: 'team-run-1',
          team_member_role: 'supervisor',
        }),
      );
    });

    const structuredOutput = {
      action: 'delegate',
      next_worker: 'member-executor',
      instructions: 'Write focused tests.',
      correlation_id: 'route-1',
    };

    act(() => {
      fireEdgeEvent(makeEvent('run.agent.route_decision', { runId: 'run-1', ...structuredOutput }));
      fireEdgeEvent(
        makeEvent('run.agent.result', { runId: 'run-1', success: true, structuredOutput }),
      );
    });

    expect(hubClient.postTeamRouteDecision).toHaveBeenCalledTimes(1);
    expect(hubClient.doneTask).toHaveBeenCalledWith(
      'task-1',
      JSON.stringify({ runId: 'run-1', success: true, structuredOutput }),
      'run-1',
    );
  });

  it('does not post route decisions for non-supervisor team members', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({
          team_id: 'team-1',
          team_run_id: 'team-run-1',
          team_member_role: 'executor',
        }),
      );
    });

    act(() => {
      fireEdgeEvent(
        makeEvent('run.agent.route_decision', {
          runId: 'run-1',
          action: 'delegate',
          next_worker: 'member-reviewer',
          instructions: 'Review it.',
        }),
      );
    });

    expect(hubClient.postTeamRouteDecision).not.toHaveBeenCalled();
  });

  it('calls doneTask on successful run.agent.result', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    act(() => {
      fireEdgeEvent(
        makeEvent('run.agent.result', { runId: 'run-1', success: true, content: 'done' }),
      );
    });

    expect(hubClient.streamTaskEvent).toHaveBeenCalledWith(
      'task-1',
      'run.agent.result',
      { runId: 'run-1', success: true, content: 'done' },
      { runId: 'run-1' },
    );
    expect(hubClient.doneTask).toHaveBeenCalledWith('task-1', 'done', 'run-1');
    expect(hoisted.storeTasks).toContainEqual(
      expect.objectContaining({
        taskId: 'task-1',
        runId: 'run-1',
        status: 'done',
      }),
    );
  });

  it('uses remembered output for successful run.agent.result without content', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    act(() => {
      fireEdgeEvent(
        makeEvent('run.agent.text_block', { runId: 'run-1', content: 'visible answer' }),
      );
      fireEdgeEvent(makeEvent('run.agent.result', { runId: 'run-1', success: true }));
    });

    expect(hubClient.doneTask).toHaveBeenCalledWith('task-1', 'visible answer', 'run-1');
  });

  it('calls failTask on failed run.agent.result', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    act(() => {
      fireEdgeEvent(
        makeEvent('run.agent.result', { runId: 'run-1', success: false, error: 'exec failed' }),
      );
    });

    expect(hubClient.failTask).toHaveBeenCalledWith('task-1', 'exec failed', 'run-1');
  });

  it('calls failTask on run.failed event', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    act(() => {
      fireEdgeEvent(makeEvent('run.failed', { runId: 'run-1', status: 'failed' }));
    });

    expect(hubClient.failTask).toHaveBeenCalledWith('task-1', 'Run lifecycle failure', 'run-1');
  });

  it('ignores Edge events for unknown runIds', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    act(() => {
      fireEdgeEvent(makeEvent('run.agent.text_delta', { runId: 'unknown-run', content: 'x' }));
    });

    expect(hubClient.streamTaskEvent).not.toHaveBeenCalled();
  });

  it('does not subscribe to Hub events when hubWS is null', () => {
    renderHook(() => useHubIntegration({ hubWS: null, hubClient }));

    expect(hubWS.on).not.toHaveBeenCalled();
    expect((hoisted.mockStream as StreamHandle).subscribe).toHaveBeenCalled();
  });

  // ── Hub cancel → Edge cancel ────────────────────────

  it('cancels Edge run when Hub sends agent.cancel', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_CANCEL, { task_id: 'task-1' });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/v1/runs/run-1:cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // ── Hub agent.control → Edge permission decision ──────

  it('applies Hub permission.decide agent.control to Local Edge', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_AGENT_CONTROL_EVENT, {
        kind: 'permission.decide',
        agent_task_id: 'task-approval-1',
        edge_control: {
          runId: 'edge-run-1',
          requestId: 'perm-1',
          decision: 'allow',
          reason: 'Approved from TeamRun Console',
        },
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/v1/permissions/decide',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(fetchBodyFor('/v1/permissions/decide')).toEqual({
      runId: 'edge-run-1',
      requestId: 'perm-1',
      decision: 'allow',
      reason: 'Approved from TeamRun Console',
    });
  });

  it('accepts camelCase edgeControl agent.control payloads', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_AGENT_CONTROL_EVENT, {
        kind: 'permission.decide',
        edgeControl: {
          run_id: 'edge-run-2',
          request_id: 'perm-2',
          decision: 'DENY',
        },
      });
    });

    expect(fetchBodyFor('/v1/permissions/decide')).toEqual({
      runId: 'edge-run-2',
      requestId: 'perm-2',
      decision: 'deny',
    });
  });

  it('does not replay duplicate successful agent.control permission decisions in one session', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    const payload = {
      kind: 'permission.decide',
      edge_control: {
        runId: 'edge-run-dup',
        requestId: 'perm-dup',
        decision: 'allow',
      },
    };

    await act(async () => {
      fireHubEvent(HUB_AGENT_CONTROL_EVENT, payload);
      fireHubEvent(HUB_AGENT_CONTROL_EVENT, payload);
    });

    expect(fetchCallCountEndingWith('/v1/permissions/decide')).toBe(1);
  });

  it('consumes a real HTTP Edge pending permission endpoint from Hub agent.control', async () => {
    type PendingPermission = {
      projectId: string;
      threadId: string;
      runId: string;
      requestId: string;
      toolName: string;
      toolUseId: string;
    };

    const pending = new Map<string, PendingPermission>();
    const keyFor = (runId: string, requestId: string) => `${runId}\u001f${requestId}`;
    pending.set(keyFor('edge-run-live', 'perm-live'), {
      projectId: 'proj-live',
      threadId: 'thread-live',
      runId: 'edge-run-live',
      requestId: 'perm-live',
      toolName: 'Bash',
      toolUseId: 'tool-live',
    });

    const requests: Array<Record<string, unknown>> = [];
    const decidedEvents: Array<Record<string, unknown>> = [];
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/permissions/decide') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'not_found' } }));
        return;
      }

      const body = JSON.parse(await readRequestBody(req)) as {
        runId?: string;
        requestId?: string;
        decision?: string;
        reason?: string;
      };
      requests.push(body);

      if (!body.runId || !body.requestId || !['allow', 'deny'].includes(body.decision ?? '')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'bad_request' } }));
        return;
      }

      const pendingKey = keyFor(body.runId, body.requestId);
      const permission = pending.get(pendingKey);
      if (!permission) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'permission_request_not_found' } }));
        return;
      }

      pending.delete(pendingKey);
      decidedEvents.push({
        type: 'run.agent.permission_decided',
        scope: {
          projectId: permission.projectId,
          threadId: permission.threadId,
          runId: permission.runId,
        },
        payload: {
          requestId: permission.requestId,
          decision: body.decision,
          reason: body.reason,
          toolName: permission.toolName,
          toolUseId: permission.toolUseId,
        },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to start test Edge permission server');
    }
    const edgeBaseUrl = `http://127.0.0.1:${address.port}`;

    globalThis.fetch = nativeFetch as typeof globalThis.fetch;
    try {
      renderHook(() => useHubIntegration({ hubWS, hubClient, edgeBaseUrl }));

      const payload = {
        kind: 'permission.decide',
        agent_task_id: 'task-live-approval',
        edge_control: {
          runId: 'edge-run-live',
          requestId: 'perm-live',
          decision: 'allow',
          reason: 'approved by live HTTP test',
        },
      };

      await act(async () => {
        fireHubEvent(HUB_AGENT_CONTROL_EVENT, payload);
      });

      await waitFor(() => {
        expect(requests).toHaveLength(1);
        expect(decidedEvents).toHaveLength(1);
      });

      expect(requests[0]).toEqual({
        runId: 'edge-run-live',
        requestId: 'perm-live',
        decision: 'allow',
        reason: 'approved by live HTTP test',
      });
      expect(pending.has(keyFor('edge-run-live', 'perm-live'))).toBe(false);
      expect(decidedEvents[0]).toEqual({
        type: 'run.agent.permission_decided',
        scope: {
          projectId: 'proj-live',
          threadId: 'thread-live',
          runId: 'edge-run-live',
        },
        payload: {
          requestId: 'perm-live',
          decision: 'allow',
          reason: 'approved by live HTTP test',
          toolName: 'Bash',
          toolUseId: 'tool-live',
        },
      });

      await act(async () => {
        fireHubEvent(HUB_AGENT_CONTROL_EVENT, payload);
      });
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      expect(requests).toHaveLength(1);
    } finally {
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  });

  it('ignores malformed agent.control permission decisions', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_AGENT_CONTROL_EVENT, {
        kind: 'permission.decide',
        edge_control: {
          requestId: 'perm-missing-run',
          decision: 'allow',
        },
      });
      fireHubEvent(HUB_AGENT_CONTROL_EVENT, {
        kind: 'agent.stop',
        edge_control: {
          runId: 'edge-run-stop',
          requestId: 'perm-stop',
          decision: 'allow',
        },
      });
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      'Malformed agent.control permission.decide payload',
    );
    warnSpy.mockRestore();
  });

  it('uses custom edgeBaseUrl when applying agent.control permission decisions', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient, edgeBaseUrl: 'http://192.168.1.1:3210' }),
    );

    await act(async () => {
      fireHubEvent(HUB_AGENT_CONTROL_EVENT, {
        kind: 'permission.decide',
        edge_control: {
          runId: 'edge-run-custom',
          requestId: 'perm-custom',
          decision: 'allow',
        },
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.1:3210/v1/permissions/decide',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // ── Cleanup ───────────────────────────────────────────

  it('cleans up subscriptions on unmount', () => {
    const { unmount } = renderHook(() => useHubIntegration({ hubWS, hubClient }));

    expect(hubWS.on).toHaveBeenCalledWith(HUB_EVENTS.AGENT_DISPATCH, expect.any(Function));
    expect(hubWS.on).toHaveBeenCalledWith(HUB_EVENTS.AGENT_CANCEL, expect.any(Function));
    expect(hubWS.on).toHaveBeenCalledWith(HUB_AGENT_CONTROL_EVENT, expect.any(Function));
    expect((hoisted.mockStream as StreamHandle).subscribe).toHaveBeenCalled();

    unmount();

    expect(hubHandlers.get(HUB_EVENTS.AGENT_DISPATCH)?.size).toBe(0);
    expect(hubHandlers.get(HUB_EVENTS.AGENT_CANCEL)?.size).toBe(0);
    expect(hubHandlers.get(HUB_AGENT_CONTROL_EVENT)?.size).toBe(0);
    expect((hoisted.mockStream as StreamHandle).close).toHaveBeenCalled();
  });

  // ── activeTaskCount ───────────────────────────────────

  it('tracks active task count', async () => {
    const { result, rerender } = renderHook(() => useHubIntegration({ hubWS, hubClient }));

    expect(result.current.activeTaskCount).toBe(0);

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    // Force re-render so the store selector picks up the updated state
    rerender();
    expect(result.current.activeTaskCount).toBe(1);
  });

  // ── Concurrent tasks ──────────────────────────────────

  it('handles concurrent agent.dispatch events independently', async () => {
    mockRunSequence('run-A', 'run-B');

    const { result } = renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ task_id: 'task-A', session_id: 'sess-A' }),
      );
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ task_id: 'task-B', session_id: 'sess-B' }),
      );
    });

    expect(result.current.getRunByTaskId('task-A')).toBe('run-A');
    expect(result.current.getRunByTaskId('task-B')).toBe('run-B');
    expect(result.current.getTaskByRunId('run-A')?.taskId).toBe('task-A');
    expect(result.current.getTaskByRunId('run-B')?.taskId).toBe('task-B');
    expect(hubClient.ackTask).toHaveBeenCalledWith('task-A', 'run-A');
    expect(hubClient.ackTask).toHaveBeenCalledWith('task-B', 'run-B');
    expect(fetchCallCountEndingWith('/v1/threads')).toBe(2);
    expect(fetchCallCountEndingWith('/v1/runs')).toBe(2);
  });

  it('cleans up mapping for one task without affecting others', async () => {
    mockRunSequence('run-A', 'run-B');

    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ task_id: 'task-A', session_id: 'sess-A' }),
      );
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ task_id: 'task-B', session_id: 'sess-B' }),
      );
    });

    // Complete only task A via result event
    act(() => {
      fireEdgeEvent(makeEvent('run.agent.result', { runId: 'run-A', success: true }));
    });

    expect(hubClient.doneTask).toHaveBeenCalledWith('task-A', expect.any(String), 'run-A');
    expect(hubClient.doneTask).not.toHaveBeenCalledWith(
      'task-B',
      expect.any(String),
      expect.any(String),
    );
  });

  // ── Edge events after completion ──────────────────────

  it('ignores Edge events for a runId after result has been processed', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    // First result — should be processed
    act(() => {
      fireEdgeEvent(
        makeEvent('run.agent.result', { runId: 'run-1', success: true, content: 'done' }),
      );
    });
    expect(hubClient.doneTask).toHaveBeenCalledTimes(1);
    expect(hubClient.streamTaskEvent).toHaveBeenCalledTimes(1);
    expect(hoisted.storeTasks).toContainEqual(
      expect.objectContaining({
        taskId: 'task-1',
        runId: 'run-1',
        status: 'done',
      }),
    );

    // Second event for the same runId is ignored while terminal evidence stays visible locally.
    act(() => {
      fireEdgeEvent(makeEvent('run.agent.text_delta', { runId: 'run-1', content: 'late' }));
    });
    expect(hubClient.streamTaskEvent).toHaveBeenCalledTimes(1);
  });

  // ── Edge cases ────────────────────────────────────────

  it('ignores agent.cancel with missing task_id', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_CANCEL, { task_id: '' });
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('extracts model from model_params JSON when provided', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ model_params: JSON.stringify({ model: 'claude-sonnet-4-6' }) }),
      );
    });

    const fetchBody = fetchBodyFor('/v1/runs');
    expect(fetchBody.model).toBe('claude-sonnet-4-6');
  });

  it('handles invalid model_params JSON gracefully', async () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload({ model_params: 'not-json' }));
    });

    const fetchBody = fetchBodyFor('/v1/runs');
    expect(fetchBody.model).toBeUndefined();
  });

  // ── onDispatch callback ───────────────────────────────

  it('calls onDispatch callback after successful Edge run creation', async () => {
    const onDispatch = vi.fn();

    renderHook(() => useHubIntegration({ hubWS, hubClient, onDispatch }));

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    expect(onDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        runId: 'run-1',
        status: 'running',
      }),
    );
  });

  // ── Device registration is separate (tested in useDeviceRegistration) ──

  it('does not call registerDevice (delegated to useDeviceRegistration hook)', () => {
    renderHook(() => useHubIntegration({ hubWS, hubClient }));

    expect(hubClient.registerDevice).not.toHaveBeenCalled();
  });

  // ── Custom edgeBaseUrl ────────────────────────────────

  it('uses custom edgeBaseUrl when provided', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient, edgeBaseUrl: 'http://192.168.1.1:3210' }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.1:3210/v1/runs', expect.any(Object));
  });
});
