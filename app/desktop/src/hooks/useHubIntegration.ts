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
import type { CoordinatorRouteDecision, HubClient } from '@/api/hubClient';
import { createEventStream, type StreamHandle } from '@/api/eventClient';
import { edgeAuthHeaders } from '@/api/edgeAuth';
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
  /** Hub WebSocket handle (already connected & authenticated). Null disables the bridge. */
  hubWS: HubWSHandle | null;
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

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** Extract a string value that may be in a legacy DispatchPayload shape. */
function getString(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v : '';
}

function getFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function getFirstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function getFirstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  let source = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(source)) return undefined;
  const values = source.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  return values.length > 0 ? values : undefined;
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  const record = parseRecord(value);
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeRouteDecision(value: unknown): CoordinatorRouteDecision | null {
  const record = parseRecord(value);
  const nested = parseRecord(record.decision);
  const source = Object.keys(nested).length > 0 ? nested : record;
  let action = getFirstString(source.action);
  if (!action && source.finish === true) {
    action = 'finish';
  }
  action = action?.trim().toLowerCase();
  if (!action || !['delegate', 'review', 'approve', 'finish'].includes(action)) {
    return null;
  }

  return {
    action,
    next_worker: getFirstString(source.next_worker, source.nextWorker),
    instructions: getFirstString(source.instructions),
    reasoning: getFirstString(source.reasoning),
    context: getFirstString(source.context),
    approved: boolValue(source.approved),
    feedback: getFirstString(source.feedback),
    summary: getFirstString(source.summary),
    blocked_reason: getFirstString(source.blocked_reason, source.blockedReason),
    correlation_id: getFirstString(source.correlation_id, source.correlationId),
  };
}

function routeDecisionFromRuntimePayload(payload: Record<string, unknown>): CoordinatorRouteDecision | null {
  return normalizeRouteDecision(payload.structuredOutput)
    ?? normalizeRouteDecision(payload.structured_output)
    ?? normalizeRouteDecision(payload.routeDecision)
    ?? normalizeRouteDecision(payload.route_decision)
    ?? normalizeRouteDecision(payload.decision)
    ?? normalizeRouteDecision(payload);
}

interface TeamRouteContext {
  teamId: string;
  teamRunId: string;
  teamMemberRole?: string;
}

interface EdgePermissionDecisionControl {
  runId: string;
  requestId: string;
  decision: 'allow' | 'deny';
  reason?: string;
}

const HUB_AGENT_CONTROL_EVENT = 'agent.control';

function getTeamRouteContext(task: AgentTask): TeamRouteContext | null {
  const data = task.dispatchPayload ?? {};
  const modelParams = parseRecord(data.model_params);
  const nested = parseRecord(modelParams.agenthub_team_context);
  const teamId = getFirstString(data.team_id, data.teamId, nested.team_id, nested.teamId);
  const teamRunId = getFirstString(data.team_run_id, data.teamRunId, nested.team_run_id, nested.teamRunId);
  if (!teamId || !teamRunId) return null;
  return {
    teamId,
    teamRunId,
    teamMemberRole: getFirstString(data.team_member_role, data.teamMemberRole, nested.team_member_role, nested.teamMemberRole),
  };
}

function routeDecisionKey(taskId: string, decision: CoordinatorRouteDecision): string {
  return [
    taskId,
    decision.correlation_id ?? '',
    decision.action,
    decision.next_worker ?? '',
    decision.instructions ?? '',
    decision.summary ?? '',
    decision.blocked_reason ?? '',
  ].join('\u001f');
}

function parsePermissionDecisionControl(payload: unknown): EdgePermissionDecisionControl | null {
  const data = parseRecord(payload);
  const kind = getFirstString(data.kind)?.trim();
  if (kind !== 'permission.decide') return null;

  const edgeControl = parseRecord(data.edge_control);
  const fallbackControl = parseRecord(data.edgeControl);
  const source = Object.keys(edgeControl).length > 0 ? edgeControl : fallbackControl;

  const runId = getFirstString(source.runId, source.run_id);
  const requestId = getFirstString(source.requestId, source.request_id);
  const decision = getFirstString(source.decision)?.trim().toLowerCase();
  if (!runId || !requestId || (decision !== 'allow' && decision !== 'deny')) {
    return null;
  }

  return {
    runId,
    requestId,
    decision,
    reason: getFirstString(source.reason, data.reason),
  };
}

function permissionDecisionControlKey(control: EdgePermissionDecisionControl): string {
  return [
    control.runId,
    control.requestId,
    control.decision,
    control.reason ?? '',
  ].join('\u001f');
}

async function postEdgePermissionDecision(
  edgeBaseUrl: string,
  control: EdgePermissionDecisionControl,
): Promise<void> {
  const resp = await fetch(`${edgeBaseUrl}/v1/permissions/decide`, {
    method: 'POST',
    headers: edgeAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(control),
  });
  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'Unknown error');
    throw new Error(`Edge POST /v1/permissions/decide returned ${resp.status}: ${errorText}`);
  }
}

function normalizeRuntimeAgentId(agentId: string): string {
  const key = agentId.trim().toLowerCase();
  if (!key) return '';
  if (key === 'claude' || key.includes('claude-code') || key.includes('claude')) return 'claude-code';
  if (key.includes('opencode')) return 'opencode';
  if (key.includes('codex') || key.includes('gpt')) return 'codex';
  return key;
}

function buildEdgeRunBody(data: Record<string, unknown>, threadId: string, prompt: string, agentId: string): Record<string, unknown> {
  const modelParams = parseRecord(data.model_params);
  const allowedTools = parseStringArray(data.tool_whitelist)
    ?? parseStringArray(modelParams.tool_allowlist)
    ?? parseStringArray(modelParams.allowed_tools)
    ?? parseStringArray(modelParams.allowedTools);

  return {
    threadId,
    prompt: prompt || undefined,
    agentId: agentId || undefined,
    model: getFirstString(modelParams.model, data.model),
    reasoningEffort: getFirstString(modelParams.reasoning_effort, modelParams.reasoningEffort, data.reasoning_effort, data.reasoningEffort),
    thinkingMode: getFirstString(modelParams.thinking_mode, modelParams.thinkingMode, data.thinking_mode, data.thinkingMode),
    maxThinkingTokens: getFirstNumber(modelParams.max_thinking_tokens, modelParams.maxThinkingTokens, data.max_thinking_tokens, data.maxThinkingTokens),
    permissionMode: getFirstString(modelParams.permission_mode, modelParams.permissionMode, data.permission_mode, data.permissionMode),
    workDir: getFirstString(modelParams.work_dir, modelParams.workDir, data.work_dir, data.workDir),
    includePartial: getFirstBoolean(modelParams.include_partial, modelParams.includePartial, data.include_partial, data.includePartial),
    structuredOutputSchema: getFirstString(modelParams.structured_output_schema, modelParams.structuredOutputSchema, data.structured_output_schema, data.structuredOutputSchema),
    systemPrompt: getFirstString(data.system_prompt, data.systemPrompt, modelParams.system_prompt, modelParams.systemPrompt),
    appendSystemPrompt: getFirstString(modelParams.append_system_prompt, modelParams.appendSystemPrompt, data.append_system_prompt, data.appendSystemPrompt),
    allowedTools,
    configOverrides: parseStringRecord(modelParams.config_overrides) ?? parseStringRecord(modelParams.configOverrides),
    ephemeral: getFirstBoolean(modelParams.ephemeral, data.ephemeral),
  };
}

async function ensureEdgeThread(edgeBaseUrl: string, threadId: string, title: string): Promise<void> {
  const resp = await fetch(`${edgeBaseUrl}/v1/threads`, {
    method: 'POST',
    headers: edgeAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      projectId: 'proj_local',
      threadId,
      title,
    }),
  });
  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'Unknown error');
    throw new Error(`Edge POST /v1/threads returned ${resp.status}: ${errorText}`);
  }
}

const FINAL_OUTPUT_MAX_CHARS = 32_000;

function extractRunOutputBatch(payload: Record<string, unknown>): string {
  if (payload.stream !== 'stdout' || !Array.isArray(payload.chunks)) return '';
  return payload.chunks
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object') return '';
      const text = (chunk as Record<string, unknown>).text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

// ── Hook ──────────────────────────────────────────────

export function useHubIntegration(
  options: HubIntegrationOptions,
): HubIntegrationHandle {
  const { hubWS, hubClient, edgeBaseUrl = 'http://127.0.0.1:3210', onDispatch } = options;

  const streamRef = useRef<StreamHandle | null>(null);
  const outputByRunRef = useRef<Map<string, string>>(new Map());
  const postedRouteDecisionsRef = useRef<Set<string>>(new Set());
  const deliveredAgentControlsRef = useRef<Set<string>>(new Set());
  const inFlightAgentControlsRef = useRef<Set<string>>(new Set());
  /** RunIds whose terminal result has already been reported to Hub (prevents
   *  double doneTask / failTask across run.agent.result and run.finished/failed). */
  const reportedRunIdsRef = useRef<Set<string>>(new Set());
  const store = useTaskBridgeStore;

  const rememberOutput = useCallback((runId: string, content: string) => {
    if (!content) return;
    const prev = outputByRunRef.current.get(runId) ?? '';
    outputByRunRef.current.set(
      runId,
      (prev + content).slice(-FINAL_OUTPUT_MAX_CHARS),
    );
  }, []);

  const forgetOutput = useCallback((runId: string) => {
    outputByRunRef.current.delete(runId);
  }, []);

  const postRouteDecision = useCallback((task: AgentTask, decision: CoordinatorRouteDecision) => {
    const context = getTeamRouteContext(task);
    if (!context) return;
    if (context.teamMemberRole && context.teamMemberRole !== 'supervisor') return;

    const key = routeDecisionKey(task.taskId, decision);
    if (postedRouteDecisionsRef.current.has(key)) return;
    postedRouteDecisionsRef.current.add(key);

    hubClient
      .postTeamRouteDecision(context.teamId, context.teamRunId, decision)
      .catch(() => {});
  }, [hubClient]);

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

      const taskId = task.taskId;

      switch (event.type) {
        case 'run.agent.text_delta': {
          const content = typeof payload.content === 'string' ? payload.content : '';
          if (content) {
            rememberOutput(runId, content);
            hubClient.streamTaskEvent(taskId, event.type, payload, { runId }).catch(() => {});
          }
          break;
        }

        case 'run.agent.text_block': {
          const content = typeof payload.content === 'string' ? payload.content : '';
          if (content) {
            rememberOutput(runId, content);
            hubClient.streamTaskEvent(taskId, event.type, payload, { runId }).catch(() => {});
          }
          break;
        }

        case 'run.output.batch': {
          const content = extractRunOutputBatch(payload);
          if (content) {
            rememberOutput(runId, content);
            hubClient.streamTaskEvent(taskId, event.type, payload, { runId }).catch(() => {});
          }
          break;
        }

        case 'run.agent.thinking': {
          const content = typeof payload.content === 'string' ? payload.content : '';
          if (content) {
            hubClient.streamTaskEvent(taskId, event.type, payload, { runId }).catch(() => {});
          }
          break;
        }

        case 'run.agent.tool_call':
        case 'run.agent.tool_result':
        case 'run.agent.file_change':
          // Forward the canonical typed runtime event so Hub can persist and replay it.
          hubClient
            .streamTaskEvent(taskId, event.type, payload, { runId })
            .catch(() => {});
          break;

        case 'run.agent.route_decision': {
          const decision = routeDecisionFromRuntimePayload(payload);
          if (decision) {
            postRouteDecision(task, decision);
          }
          hubClient.streamTaskEvent(taskId, event.type, payload, { runId }).catch(() => {});
          break;
        }

        case 'run.agent.result': {
          // Idempotency guard — if we already reported this run, skip
          if (reportedRunIdsRef.current.has(runId)) break;

          const decision = routeDecisionFromRuntimePayload(payload);
          if (decision) {
            postRouteDecision(task, decision);
          }
          hubClient.streamTaskEvent(taskId, event.type, payload, { runId }).catch(() => {});
          const success = payload.success !== false;
          if (success) {
            const output =
              typeof payload.content === 'string'
                ? payload.content
                : outputByRunRef.current.get(runId) || JSON.stringify(payload);
            hubClient.doneTask(taskId, output, runId).catch(() => {});
          } else {
            const error =
              typeof payload.error === 'string'
                ? payload.error
                : 'Agent reported failure';
            hubClient.failTask(taskId, error, runId).catch(() => {});
          }
          // Record that we have reported this run's terminal state to Hub —
          // prevents a second doneTask / failTask when run.finished/failed/cancelled
          // arrives later.
          reportedRunIdsRef.current.add(runId);
          store.getState().removeTask(taskId);
          forgetOutput(runId);
          break;
        }

        case 'run.finished': {
          // If run.agent.result already reported this run, just clean up local state.
          if (reportedRunIdsRef.current.has(runId)) {
            store.getState().removeTask(taskId);
            forgetOutput(runId);
            break;
          }
          const output = outputByRunRef.current.get(runId) || 'Run finished';
          hubClient.doneTask(taskId, output, runId).catch(() => {});
          reportedRunIdsRef.current.add(runId);
          store.getState().removeTask(taskId);
          forgetOutput(runId);
          break;
        }

        case 'run.failed': {
          if (reportedRunIdsRef.current.has(runId)) {
            store.getState().removeTask(taskId);
            forgetOutput(runId);
            break;
          }
          const error =
            typeof payload.error === 'string'
              ? payload.error
              : 'Run lifecycle failure';
          hubClient.failTask(taskId, error, runId).catch(() => {});
          reportedRunIdsRef.current.add(runId);
          store.getState().removeTask(taskId);
          forgetOutput(runId);
          break;
        }

        case 'run.cancelled': {
          if (reportedRunIdsRef.current.has(runId)) {
            store.getState().removeTask(taskId);
            forgetOutput(runId);
            break;
          }
          hubClient.failTask(taskId, 'Run cancelled', runId).catch(() => {});
          reportedRunIdsRef.current.add(runId);
          store.getState().removeTask(taskId);
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
  }, [edgeBaseUrl, hubClient, postRouteDecision, rememberOutput, forgetOutput, store]);

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
      const agentId = normalizeRuntimeAgentId(getString(data, 'agent_type') || getString(data, 'agent_id'));
      const prompt = getString(data, 'prompt') || getString(data, 'content');
      const threadId =
        getString(data, 'thread_id') ||
        getString(data, 'session_id') ||
        'hub-dispatch';

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
        await ensureEdgeThread(
          edgeBaseUrl,
          threadId,
          getString(data, 'display_name') || 'Hub dispatch',
        );

        const runResp = await fetch(`${edgeBaseUrl}/v1/runs`, {
          method: 'POST',
          headers: edgeAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(buildEdgeRunBody(data, threadId, prompt, agentId)),
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
        hubClient.ackTask(taskId, runId).catch(() => {});

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
          headers: edgeAuthHeaders(),
        });
        store.getState().removeTask(taskId);
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
          console.warn('[useHubIntegration] Malformed agent.control permission.decide payload:', payload);
        }
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
        console.warn('[useHubIntegration] Failed to apply agent.control permission.decide:', errorMsg);
      } finally {
        inFlightAgentControlsRef.current.delete(key);
      }
    });

    return () => {
      unsubDispatch();
      unsubCancel();
      unsubControl();
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
