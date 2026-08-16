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
import type { HubWSHandle } from '@shared/hub/hubWS';
import type { CoordinatorRouteDecision, HubClient } from '@/api/hubClient';
import { createEventStream, type StreamHandle } from '@/api/eventClient';
import type { EventEnvelope } from '@shared/events';
import { HUB_EVENTS } from '@shared/hubEvents';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { useTaskBridgeStore, type AgentTask } from '@/stores/taskBridgeStore';
import { queryClient } from '@/api/queryClient';
import { edgeRequestInit, ensureEdgeThread, postEdgePermissionDecision } from './hubIntegrationEdgeApi';
import {
  bindDispatchPayload,
  buildDispatchTargetBinding,
  buildEdgeRunBody,
  extractCreatedRunId,
  extractRunOutputBatch,
  FINAL_OUTPUT_MAX_CHARS,
  getTeamRouteContext,
  isTerminalBridgeTask,
  normalizeRuntimeAgentId,
  parsePermissionDecisionControl,
  permissionDecisionControlKey,
  routeDecisionFromRuntimePayload,
  routeDecisionKey,
  type HubDispatchTarget,
  validateDispatchTarget,
} from './hubIntegrationMappers';
import { getFirstString, getString, parseRecord } from './hubIntegrationParseHelpers';
import { catchHubReport } from './hubReportUtils';

export type { AgentTask };
export { useTaskBridgeStore };

// ── Options ─────────────────────────────────────────

export interface HubIntegrationOptions {
  /** Hub WebSocket handle (already connected & authenticated). Null disables the bridge. */
  hubWS: HubWSHandle | null;
  /** Hub REST client for reporting task progress. */
  hubClient: HubClient;
  /** Edge server base URL (default http://127.0.0.1:3210). */
  edgeBaseUrl?: string;
  /** Exact Hub target/device this Desktop is allowed to hand off to Local Edge. */
  dispatchTarget?: HubDispatchTarget | null;
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

const HUB_AGENT_CONTROL_EVENT = 'agent.control';

// ── Hook ──────────────────────────────────────────────

export function useHubIntegration(options: HubIntegrationOptions): HubIntegrationHandle {
  const {
    hubWS,
    hubClient,
    edgeBaseUrl = 'http://127.0.0.1:3210',
    dispatchTarget = null,
    onDispatch,
  } = options;

  const streamRef = useRef<StreamHandle | null>(null);
  const outputByRunRef = useRef<Map<string, string>>(new Map());
  const postedRouteDecisionsRef = useRef<Set<string>>(new Set());
  const deliveredAgentControlsRef = useRef<Set<string>>(new Set());
  const inFlightAgentControlsRef = useRef<Set<string>>(new Set());
  const store = useTaskBridgeStore;

  const rememberOutput = useCallback((runId: string, content: string) => {
    if (!content) return;
    const prev = outputByRunRef.current.get(runId) ?? '';
    outputByRunRef.current.set(runId, (prev + content).slice(-FINAL_OUTPUT_MAX_CHARS));
  }, []);

  const forgetOutput = useCallback((runId: string) => {
    outputByRunRef.current.delete(runId);
  }, []);

  const postRouteDecision = useCallback(
    (task: AgentTask, decision: CoordinatorRouteDecision) => {
      const context = getTeamRouteContext(task);
      if (!context) return;
      if (context.teamMemberRole && context.teamMemberRole !== 'supervisor') return;

      const key = routeDecisionKey(task.taskId, decision);
      if (postedRouteDecisionsRef.current.has(key)) return;
      postedRouteDecisionsRef.current.add(key);

      void catchHubReport(
        `postTeamRouteDecision:${context.teamId}:${context.teamRunId}`,
        hubClient.postTeamRouteDecision(context.teamId, context.teamRunId, decision),
      );
    },
    [hubClient],
  );

  // ── Initialise Edge event stream once ─────────────────

  useEffect(() => {
    // Build Edge WebSocket URL from the REST base URL
    const edgeWsUrl = edgeBaseUrl.replace(/^http/, 'ws') + '/v1/events';
    const stream = createEventStream(edgeWsUrl);
    streamRef.current = stream;

    // Global Edge event handler — filter by runId and route to Hub callbacks
    const unsub = stream.subscribe((event: EventEnvelope) => {
      const payload = event.payload ?? {};
      const runId = typeof payload.runId === 'string' ? payload.runId : '';
      if (!runId) return;

      const task = store.getState().getTaskByRunId(runId);
      if (!task) return; // not one of our bridged tasks
      if (isTerminalBridgeTask(task)) return;

      const taskId = task.taskId;

      switch (event.type) {
        case 'run.agent.text_delta': {
          const content = typeof payload.content === 'string' ? payload.content : '';
          if (content) {
            rememberOutput(runId, content);
            void catchHubReport(
              `streamTaskEvent:${taskId}:${event.type}`,
              hubClient.streamTaskEvent(taskId, event.type, payload, { runId }),
            );
          }
          break;
        }

        case 'run.agent.text_block': {
          const content = typeof payload.content === 'string' ? payload.content : '';
          if (content) {
            rememberOutput(runId, content);
            void catchHubReport(
              `streamTaskEvent:${taskId}:${event.type}`,
              hubClient.streamTaskEvent(taskId, event.type, payload, { runId }),
            );
          }
          break;
        }

        case 'run.output.batch': {
          const content = extractRunOutputBatch(payload);
          if (content) {
            rememberOutput(runId, content);
            void catchHubReport(
              `streamTaskEvent:${taskId}:${event.type}`,
              hubClient.streamTaskEvent(taskId, event.type, payload, { runId }),
            );
          }
          break;
        }

        case 'run.agent.thinking': {
          const content = typeof payload.content === 'string' ? payload.content : '';
          if (content) {
            void catchHubReport(
              `streamTaskEvent:${taskId}:${event.type}`,
              hubClient.streamTaskEvent(taskId, event.type, payload, { runId }),
            );
          }
          break;
        }

        case 'run.agent.tool_call':
        case 'run.agent.tool_result':
        case 'run.agent.file_change':
        case 'run.agent.permission_requested':
        case 'run.agent.permission_decided':
          // Forward the canonical typed runtime event so Hub can persist and replay it.
          void catchHubReport(
            `streamTaskEvent:${taskId}:${event.type}`,
            hubClient.streamTaskEvent(taskId, event.type, payload, { runId }),
          );
          break;

        case 'run.agent.route_decision': {
          const decision = routeDecisionFromRuntimePayload(payload);
          if (decision) {
            postRouteDecision(task, decision);
          }
          void catchHubReport(
            `streamTaskEvent:${taskId}:${event.type}`,
            hubClient.streamTaskEvent(taskId, event.type, payload, { runId }),
          );
          break;
        }

        case 'run.agent.result': {
          const decision = routeDecisionFromRuntimePayload(payload);
          if (decision) {
            postRouteDecision(task, decision);
          }
          void catchHubReport(
            `streamTaskEvent:${taskId}:${event.type}`,
            hubClient.streamTaskEvent(taskId, event.type, payload, { runId }),
          );
          const success = payload.success !== false;
          if (success) {
            const output =
              typeof payload.content === 'string'
                ? payload.content
                : outputByRunRef.current.get(runId) || JSON.stringify(payload);
            void catchHubReport(
              `doneTask:${taskId}`,
              hubClient.doneTask(taskId, output, runId),
            );
            store.getState().updateTask(taskId, {
              status: 'done',
            });
            void queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
          } else {
            const error =
              typeof payload.error === 'string' ? payload.error : 'Agent reported failure';
            void catchHubReport(
              `failTask:${taskId}`,
              hubClient.failTask(taskId, error, runId),
            );
            store.getState().updateTask(taskId, {
              status: 'failed',
              error,
            });
            void queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
          }
          forgetOutput(runId);
          break;
        }

        case 'run.finished': {
          const output = outputByRunRef.current.get(runId) || 'Run finished';
          void catchHubReport(
            `doneTask:${taskId}`,
            hubClient.doneTask(taskId, output, runId),
          );
          store.getState().updateTask(taskId, {
            status: 'done',
          });
          forgetOutput(runId);
          break;
        }

        case 'run.failed': {
          const error = typeof payload.error === 'string' ? payload.error : 'Run lifecycle failure';
          void catchHubReport(
            `failTask:${taskId}`,
            hubClient.failTask(taskId, error, runId),
          );
          store.getState().updateTask(taskId, {
            status: 'failed',
            error,
          });
          forgetOutput(runId);
          break;
        }

        case 'run.cancelled': {
          void catchHubReport(
            `failTask:${taskId}`,
            hubClient.failTask(taskId, 'Run cancelled', runId),
          );
          store.getState().updateTask(taskId, {
            status: 'failed',
            error: 'Run cancelled',
          });
          forgetOutput(runId);
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
    if (!hubWS) {
      return;
    }
    // ── agent.dispatch: create Edge run ────────────────
    const unsubDispatch = hubWS.on(HUB_EVENTS.AGENT_DISPATCH, async (payload: unknown) => {
      const data = payload as Record<string, unknown> | null;
      if (!data || typeof data.task_id !== 'string' || !data.task_id) {
        console.warn('[useHubIntegration] Invalid agent.dispatch payload:', payload);
        return;
      }

      const taskId = data.task_id;
      const targetBinding = buildDispatchTargetBinding(data, dispatchTarget);
      const dispatchPayload = bindDispatchPayload(data, targetBinding);
      const targetError = validateDispatchTarget(data, dispatchTarget);

      // Invalidate team-related caches on dispatch
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
      if (targetError) {
        store.getState().addTask({
          taskId,
          agentId: normalizeRuntimeAgentId(
            getString(data, 'agent_type') || getString(data, 'agent_id'),
          ),
          prompt: getString(data, 'prompt') || getString(data, 'content'),
          threadId: getString(data, 'thread_id') || getString(data, 'session_id') || 'hub-dispatch',
          status: 'failed',
          dispatchPayload,
          error: targetError,
          createdAt: new Date().toISOString(),
        });
        void catchHubReport(`failTask:${taskId}`, hubClient.failTask(taskId, targetError));
        return;
      }

      const agentId = normalizeRuntimeAgentId(
        getString(data, 'agent_type') || getString(data, 'agent_id'),
      );
      const prompt = getString(data, 'prompt') || getString(data, 'content');
      const threadId =
        getString(data, 'thread_id') || getString(data, 'session_id') || 'hub-dispatch';

      // Build initial task record
      const task: AgentTask = {
        taskId,
        agentId,
        prompt,
        threadId,
        status: 'queued',
        dispatchPayload,
        createdAt: new Date().toISOString(),
      };

      store.getState().addTask(task);

      // Create Edge run
      try {
        await ensureEdgeThread(
          edgeBaseUrl,
          threadId,
          getString(data, 'display_name') || 'Hub dispatch',
        );

        const runResp = await fetch(
          `${edgeBaseUrl}/v1/runs`,
          edgeRequestInit(
            {
              method: 'POST',
              body: JSON.stringify(buildEdgeRunBody(data, threadId, prompt, agentId, targetBinding)),
            },
            { 'Content-Type': 'application/json' },
          ),
        );

        if (!runResp.ok) {
          const errorText = await runResp.text().catch(() => 'Unknown error');
          throw new Error(`Edge POST /v1/runs returned ${runResp.status}: ${errorText}`);
        }

        const runId = extractCreatedRunId(await runResp.json());

        // Map taskId ↔ runId and mark running
        store.getState().updateTask(taskId, { runId, status: 'running' });

        // Acknowledge task to Hub (log failures — do not throw into dispatch handler)
        void catchHubReport(`ackTask:${taskId}`, hubClient.ackTask(taskId, runId));

        // Notify consumer
        const updatedTask = store.getState().tasks.find((t) => t.taskId === taskId);
        if (updatedTask) {
          onDispatch?.(updatedTask);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        store.getState().updateTask(taskId, {
          status: 'failed',
          error: errorMsg,
        });
        void catchHubReport(`failTask:${taskId}`, hubClient.failTask(taskId, errorMsg));
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
        await fetch(
          `${edgeBaseUrl}/v1/runs/${encodeURIComponent(runId)}:cancel`,
          edgeRequestInit({
            method: 'POST',
          }),
        );
        store.getState().updateTask(taskId, {
          status: 'failed',
          error: 'Cancelled by Hub',
        });
      } catch {
        // Best-effort cancel — Edge may already be stopped
      }
    });

    // ── agent.control: apply Hub-originated control to Local Edge ─────
    const unsubControl = hubWS.on(HUB_AGENT_CONTROL_EVENT as never, async (payload: unknown) => {
      const control = parsePermissionDecisionControl(payload);
      if (!control) {
        const kind = getFirstString(parseRecord(payload).kind);
        if (kind === 'permission.decide') {
          console.warn(
            '[useHubIntegration] Malformed agent.control permission.decide payload:',
            payload,
          );
        }
        return;
      }
      const targetError = validateDispatchTarget(parseRecord(payload), dispatchTarget);
      if (targetError) {
        console.warn(
          '[useHubIntegration] Refusing agent.control for another Desktop target:',
          targetError,
        );
        return;
      }

      const key = permissionDecisionControlKey(control);
      if (deliveredAgentControlsRef.current.has(key) || inFlightAgentControlsRef.current.has(key)) {
        return;
      }

      inFlightAgentControlsRef.current.add(key);
      try {
        await postEdgePermissionDecision(edgeBaseUrl, control);
        deliveredAgentControlsRef.current.add(key);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(
          '[useHubIntegration] Failed to apply agent.control permission.decide:',
          errorMsg,
        );
      } finally {
        inFlightAgentControlsRef.current.delete(key);
      }
    });

    return () => {
      unsubDispatch();
      unsubCancel();
      unsubControl();
    };
  }, [hubWS, hubClient, edgeBaseUrl, dispatchTarget, onDispatch, store]);

  // ── Return stable handle ──────────────────────────────

  const getTaskByRunId = useCallback((runId: string) => store.getState().getTaskByRunId(runId), [store]);

  const getRunByTaskId = useCallback(
    (taskId: string) => store.getState().getRunByTaskId(taskId),
    [store],
  );

  // Read tasks reactively from the store
  const tasks = store((s) => s.tasks);
  const activeTaskCount = store(
    (s) => s.tasks.filter((t) => t.status === 'running' || t.status === 'queued').length,
  );

  return {
    tasks,
    activeTaskCount,
    getTaskByRunId,
    getRunByTaskId,
  };
}
