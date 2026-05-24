// Hub-Edge Agent Task Bridge — the core integration hook that completes
// the 3-layer E2E flow:
//
//   Web Client → Hub (agent.dispatch) → Desktop (this hook)
//     → Edge (POST /v1/runs) → CLI Agent
//     → Edge (run.agent.* events) → Desktop → Hub (stream/done/fail)
//     → Web Client (sees agent response in chat)
//
// Responsibilities:
//   1. Listen for agent.dispatch events from Hub WS
//   2. Translate dispatch payload into Edge StartRunRequest and create Edge run
//   3. Map taskId ↔ runId bidirectionally
//   4. Forward Edge run output events back to Hub as stream/done/fail callbacks
//   5. Handle agent.cancel from Hub (cancel Edge run)
//   6. Handle errors gracefully (never crash Desktop)

import { useEffect, useRef, useCallback } from 'react';
import type { HubWSHandle } from '@/api/hubWS';
import type { HubClient } from '@/api/hubClient';
import { createEventStream, type StreamHandle } from '@/api/eventClient';
import type { EventEnvelope } from '@shared/events';
import { HUB_EVENTS } from '@shared/hubEvents';
import {
  useTaskBridgeStore,
  type AgentTask,
} from '@/stores/taskBridgeStore';

export type { AgentTask };
export { useTaskBridgeStore };

// ── Options ─────────────────────────────────────────

export interface HubIntegrationOptions {
  /** Hub WebSocket handle (already connected & authenticated). */
  hubWS: HubWSHandle;
  /** Hub REST client for reporting task progress. */
  hubClient: HubClient;
  /** Edge server base URL (default http://127.0.0.1:3210). */
  edgeBaseUrl?: string;
  /** Called when a new agent task is dispatched and the Edge run has been created. */
  onDispatch?: (task: AgentTask) => void;
}

export interface HubIntegrationHandle {
  /** All bridged tasks (queued + running + done + failed). */
  tasks: AgentTask[];
  /** Number of currently active (running) tasks. */
  activeTaskCount: number;
  /** Look up a task by its Edge runId. */
  getTaskByRunId: (runId: string) => AgentTask | undefined;
  /** Look up an Edge runId by its Hub taskId. */
  getRunByTaskId: (taskId: string) => string | undefined;
}

// ── Helpers ──────────────────────────────────────────

function tryParseModel(modelParams: unknown): string | undefined {
  if (typeof modelParams !== 'string') return undefined;
  try {
    const parsed = JSON.parse(modelParams);
    return typeof parsed.model === 'string' ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

/** Extract a string value that may be in a legacy DispatchPayload shape. */
function getString(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v : '';
}

// ── Hook ──────────────────────────────────────────────

export function useHubIntegration(
  options: HubIntegrationOptions,
): HubIntegrationHandle {
  const { hubWS, hubClient, edgeBaseUrl = 'http://127.0.0.1:3210', onDispatch } = options;

  const streamRef = useRef<StreamHandle | null>(null);
  const store = useTaskBridgeStore;

  // ── Initialise Edge event stream once ─────────────────

  useEffect(() => {
    const stream = createEventStream();
    streamRef.current = stream;

    // Global Edge event handler — filter by runId and route to Hub callbacks
    const unsub = stream.subscribe((event: EventEnvelope) => {
      const payload = event.payload ?? {};
      const runId = typeof payload.runId === 'string' ? payload.runId : '';
      if (!runId) return;

      const task = store.getState().getTaskByRunId(runId);
      if (!task) return; // not one of our bridged tasks

      const taskId = task.taskId;

      switch (event.type) {
        case 'run.agent.text_delta': {
          const content = typeof payload.content === 'string' ? payload.content : '';
          if (content) {
            hubClient.streamTask(taskId, content).catch(() => {});
          }
          break;
        }

        case 'run.agent.text_block': {
          const content = typeof payload.content === 'string' ? payload.content : '';
          if (content) {
            hubClient.streamTask(taskId, content).catch(() => {});
          }
          break;
        }

        case 'run.agent.thinking': {
          const content = typeof payload.content === 'string' ? payload.content : '';
          if (content) {
            hubClient.streamTask(taskId, content).catch(() => {});
          }
          break;
        }

        case 'run.agent.tool_call':
        case 'run.agent.tool_result':
        case 'run.agent.file_change':
          // Forward tool metadata for chat visibility
          hubClient
            .streamTask(taskId, JSON.stringify(payload))
            .catch(() => {});
          break;

        case 'run.agent.result': {
          const success = payload.success !== false;
          if (success) {
            const output =
              typeof payload.content === 'string'
                ? payload.content
                : JSON.stringify(payload);
            hubClient.doneTask(taskId, output).catch(() => {});
            store.getState().updateTask(taskId, {
              status: 'done',
            });
          } else {
            const error =
              typeof payload.error === 'string'
                ? payload.error
                : 'Agent reported failure';
            hubClient.failTask(taskId, error).catch(() => {});
            store.getState().updateTask(taskId, {
              status: 'failed',
              error,
            });
          }
          // Clean up mapping after terminal event
          store.getState().removeTask(taskId);
          break;
        }

        case 'run.failed': {
          const error =
            typeof payload.error === 'string'
              ? payload.error
              : 'Run lifecycle failure';
          hubClient.failTask(taskId, error).catch(() => {});
          store.getState().updateTask(taskId, {
            status: 'failed',
            error,
          });
          store.getState().removeTask(taskId);
          break;
        }

        case 'run.cancelled': {
          hubClient.failTask(taskId, 'Run cancelled').catch(() => {});
          store.getState().updateTask(taskId, {
            status: 'failed',
            error: 'Run cancelled',
          });
          store.getState().removeTask(taskId);
          break;
        }
      }
    });

    return () => {
      unsub();
      stream.close();
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeBaseUrl]);

  // ── Listen for Hub agent.dispatch and agent.cancel ────

  useEffect(() => {
    // ── agent.dispatch: create Edge run ────────────────
    const unsubDispatch = hubWS.on(HUB_EVENTS.AGENT_DISPATCH, async (payload: unknown) => {
      const data = payload as Record<string, unknown> | null;
      if (!data || typeof data.task_id !== 'string' || !data.task_id) {
        console.warn('[useHubIntegration] Invalid agent.dispatch payload:', payload);
        return;
      }

      const taskId = data.task_id;
      const agentId = getString(data, 'agent_type') || getString(data, 'agent_id');
      const prompt = getString(data, 'prompt') || getString(data, 'content');
      const threadId =
        getString(data, 'thread_id') ||
        getString(data, 'session_id') ||
        undefined;
      const model = tryParseModel(data.model_params) || getString(data, 'model') || undefined;

      // Build initial task record
      const task: AgentTask = {
        taskId,
        agentId,
        prompt,
        threadId,
        status: 'queued',
        dispatchPayload: data,
        createdAt: new Date().toISOString(),
      };

      store.getState().addTask(task);

      // Create Edge run
      try {
        const runResp = await fetch(`${edgeBaseUrl}/v1/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: threadId || 'hub-dispatch',
            prompt: prompt || undefined,
            agentId: agentId || undefined,
            model,
          }),
        });

        if (!runResp.ok) {
          const errorText = await runResp.text().catch(() => 'Unknown error');
          throw new Error(`Edge POST /v1/runs returned ${runResp.status}: ${errorText}`);
        }

        const run = (await runResp.json()) as { id?: string; runId?: string };
        const runId = run.id || run.runId || '';
        if (!runId) {
          throw new Error('Edge run created but no id/runId in response');
        }

        // Map taskId ↔ runId and mark running
        store.getState().updateTask(taskId, { runId, status: 'running' });

        // Acknowledge task to Hub
        hubClient.ackTask(taskId).catch(() => {});

        // Notify consumer
        const updatedTask = store.getState().tasks.find((t) => t.taskId === taskId);
        if (updatedTask) {
          onDispatch?.(updatedTask);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[useHubIntegration] Failed to start Edge run for task ${taskId}:`, errorMsg);
        store.getState().updateTask(taskId, {
          status: 'failed',
          error: errorMsg,
        });
        hubClient.failTask(taskId, errorMsg).catch(() => {});
      }
    });

    // ── agent.cancel: cancel Edge run ────────────────
    const unsubCancel = hubWS.on(HUB_EVENTS.AGENT_CANCEL, async (payload: unknown) => {
      const data = payload as { task_id?: string } | null;
      const taskId = data?.task_id;
      if (!taskId) return;

      const runId = store.getState().getRunByTaskId(taskId);
      if (!runId) return;

      try {
        await fetch(`${edgeBaseUrl}/v1/runs/${encodeURIComponent(runId)}:cancel`, {
          method: 'POST',
        });
        store.getState().updateTask(taskId, {
          status: 'failed',
          error: 'Cancelled by Hub',
        });
        store.getState().removeTask(taskId);
      } catch {
        // Best-effort cancel — Edge may already be stopped
      }
    });

    return () => {
      unsubDispatch();
      unsubCancel();
    };
  }, [hubWS, hubClient, edgeBaseUrl, onDispatch]);

  // ── Return stable handle ──────────────────────────────

  const getTaskByRunId = useCallback(
    (runId: string) => store.getState().getTaskByRunId(runId),
    [],
  );

  const getRunByTaskId = useCallback(
    (taskId: string) => store.getState().getRunByTaskId(taskId),
    [],
  );

  // Read tasks reactively from the store
  const tasks = store((s) => s.tasks);
  const activeTaskCount = store((s) =>
    s.tasks.filter((t) => t.status === 'running' || t.status === 'queued').length,
  );

  return {
    tasks,
    activeTaskCount,
    getTaskByRunId,
    getRunByTaskId,
  };
}
