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
    updateTask: (taskId: string, updates: Partial<import('@/stores/taskBridgeStore').AgentTask>) => {
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
        const next = { ...storeRunToTask };
        delete next[task.runId];
        storeRunToTask = next;
      }
    },
    getActiveTasks: () => storeTasks.filter((t) => t.status === 'queued' || t.status === 'running'),
    clear: () => {
      storeTasks = [];
      storeRunToTask = {};
    },
  });

  return {
    get edgeHandlers() { return edgeHandlers; },
    set edgeHandlers(v: Set<(event: EventEnvelope) => void>) { edgeHandlers = v; },
    get mockStream() { return mockStream; },
    set mockStream(v: StreamHandle | null) { mockStream = v; },
    get storeTasks() { return storeTasks; },
    get storeRunToTask() { return storeRunToTask; },
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
import { renderHook, act } from '@testing-library/react';
import type { HubWSHandle } from '@/api/hubWS';
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
      streamTask: vi.fn().mockResolvedValue(undefined),
      doneTask: vi.fn().mockResolvedValue(undefined),
      failTask: vi.fn().mockResolvedValue(undefined),
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

  // ── agent.dispatch → Edge run ──────────────────────────

  it('acks task and starts Edge run on agent.dispatch', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

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
    const fetchBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchBody.threadId).toBe('sess-1');
    expect(fetchBody.agentId).toBe('claude-code');
  });

  it('maps taskId → runId and runId → taskId bidirectionally', async () => {
    const { result } = renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    expect(result.current.getRunByTaskId('task-1')).toBe('run-1');
    expect(result.current.getTaskByRunId('run-1')?.taskId).toBe('task-1');
  });

  it('reports failure to Hub when fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Edge unavailable'));

    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    expect(hubClient.failTask).toHaveBeenCalledWith('task-1', 'Edge unavailable');
  });

  it('ignores dispatch with missing task_id', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, { task_id: '', agent_type: '' });
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hubClient.ackTask).not.toHaveBeenCalled();
  });

  // ── Edge events → Hub callbacks ──────────────────────

  it('streams text_delta to Hub', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    act(() => {
      fireEdgeEvent(makeEvent('run.agent.text_delta', { runId: 'run-1', content: 'Hello' }));
    });

    expect(hubClient.streamTask).toHaveBeenCalledWith('task-1', 'Hello', 'run-1');
  });

  it('calls doneTask on successful run.agent.result', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    act(() => {
      fireEdgeEvent(makeEvent('run.agent.result', { runId: 'run-1', success: true, content: 'done' }));
    });

    expect(hubClient.doneTask).toHaveBeenCalledWith('task-1', 'done', 'run-1');
  });

  it('calls failTask on failed run.agent.result', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

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
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    act(() => {
      fireEdgeEvent(makeEvent('run.failed', { runId: 'run-1', status: 'failed' }));
    });

    expect(hubClient.failTask).toHaveBeenCalledWith('task-1', 'Run lifecycle failure', 'run-1');
  });

  it('ignores Edge events for unknown runIds', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    act(() => {
      fireEdgeEvent(makeEvent('run.agent.text_delta', { runId: 'unknown-run', content: 'x' }));
    });

    expect(hubClient.streamTask).not.toHaveBeenCalled();
  });

  // ── Hub cancel → Edge cancel ────────────────────────

  it('cancels Edge run when Hub sends agent.cancel', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

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

  // ── Cleanup ───────────────────────────────────────────

  it('cleans up subscriptions on unmount', () => {
    const { unmount } = renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    expect(hubWS.on).toHaveBeenCalledWith(HUB_EVENTS.AGENT_DISPATCH, expect.any(Function));
    expect(hubWS.on).toHaveBeenCalledWith(HUB_EVENTS.AGENT_CANCEL, expect.any(Function));
    expect((hoisted.mockStream as StreamHandle).subscribe).toHaveBeenCalled();

    unmount();

    expect(hubHandlers.get(HUB_EVENTS.AGENT_DISPATCH)?.size).toBe(0);
    expect(hubHandlers.get(HUB_EVENTS.AGENT_CANCEL)?.size).toBe(0);
    expect((hoisted.mockStream as StreamHandle).close).toHaveBeenCalled();
  });

  // ── activeTaskCount ───────────────────────────────────

  it('tracks active task count', async () => {
    const { result, rerender } = renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

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
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'run-A',
            runId: 'run-A',
            projectId: 'proj',
            threadId: 'sess-A',
            status: 'started',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'run-B',
            runId: 'run-B',
            projectId: 'proj',
            threadId: 'sess-B',
            status: 'started',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const { result } = renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload({ task_id: 'task-A', session_id: 'sess-A' }));
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload({ task_id: 'task-B', session_id: 'sess-B' }));
    });

    expect(result.current.getRunByTaskId('task-A')).toBe('run-A');
    expect(result.current.getRunByTaskId('task-B')).toBe('run-B');
    expect(result.current.getTaskByRunId('run-A')?.taskId).toBe('task-A');
    expect(result.current.getTaskByRunId('run-B')?.taskId).toBe('task-B');
    expect(hubClient.ackTask).toHaveBeenCalledWith('task-A', 'run-A');
    expect(hubClient.ackTask).toHaveBeenCalledWith('task-B', 'run-B');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cleans up mapping for one task without affecting others', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'run-A', runId: 'run-A', projectId: 'proj', threadId: 'sess-A', status: 'started' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'run-B', runId: 'run-B', projectId: 'proj', threadId: 'sess-B', status: 'started' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload({ task_id: 'task-A', session_id: 'sess-A' }));
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload({ task_id: 'task-B', session_id: 'sess-B' }));
    });

    // Complete only task A via result event
    act(() => {
      fireEdgeEvent(makeEvent('run.agent.result', { runId: 'run-A', success: true }));
    });

    expect(hubClient.doneTask).toHaveBeenCalledWith('task-A', expect.any(String), 'run-A');
    expect(hubClient.doneTask).not.toHaveBeenCalledWith('task-B', expect.any(String), expect.any(String));
  });

  // ── Edge events after completion ──────────────────────

  it('ignores Edge events for a runId after result has been processed', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_DISPATCH, makeDispatchPayload());
    });

    // First result — should be processed
    act(() => {
      fireEdgeEvent(makeEvent('run.agent.result', { runId: 'run-1', success: true, content: 'done' }));
    });
    expect(hubClient.doneTask).toHaveBeenCalledTimes(1);

    // Second event for the same runId — mapping cleaned up, should be ignored
    act(() => {
      fireEdgeEvent(makeEvent('run.agent.text_delta', { runId: 'run-1', content: 'late' }));
    });
    expect(hubClient.streamTask).not.toHaveBeenCalled();
  });

  // ── Edge cases ────────────────────────────────────────

  it('ignores agent.cancel with missing task_id', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(HUB_EVENTS.AGENT_CANCEL, { task_id: '' });
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('extracts model from model_params JSON when provided', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ model_params: JSON.stringify({ model: 'claude-sonnet-4-6' }) }),
      );
    });

    const fetchBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchBody.model).toBe('claude-sonnet-4-6');
  });

  it('handles invalid model_params JSON gracefully', async () => {
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

    await act(async () => {
      fireHubEvent(
        HUB_EVENTS.AGENT_DISPATCH,
        makeDispatchPayload({ model_params: 'not-json' }),
      );
    });

    const fetchBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchBody.model).toBeUndefined();
  });

  // ── onDispatch callback ───────────────────────────────

  it('calls onDispatch callback after successful Edge run creation', async () => {
    const onDispatch = vi.fn();

    renderHook(() =>
      useHubIntegration({ hubWS, hubClient, onDispatch }),
    );

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
    renderHook(() =>
      useHubIntegration({ hubWS, hubClient }),
    );

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

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.1:3210/v1/runs',
      expect.any(Object),
    );
  });
});
