// Pure mappers for Hub agent.dispatch ↔ Edge run bridge payloads.
// No React, no Hub client side effects — safe for unit tests.

import type { CoordinatorRouteDecision } from '@/api/hubClient';
import type { AgentTask } from '@/stores/taskBridgeStore';
import {
  boolValue,
  compactRecord,
  getFirstBoolean,
  getFirstNumber,
  getFirstString,
  parseRecord,
  parseStringArray,
  parseStringRecord,
} from './hubIntegrationParseHelpers';

interface TeamRouteContext {
  teamId: string;
  teamRunId: string;
  teamMemberRole?: string;
}

export interface EdgePermissionDecisionControl {
  runId: string;
  requestId: string;
  decision: 'allow' | 'deny';
  reason?: string;
}

export interface HubDispatchTarget {
  targetId: string;
  deviceId: string;
}

interface DispatchTargetBindingEvidence {
  expectedTargetId: string;
  observedTargetId?: string;
  expectedEdgeDeviceId: string;
  observedEdgeDeviceId?: string;
  status: 'matched' | 'mismatch';
}

export function isTerminalBridgeTask(task: AgentTask): boolean {
  return task.status === 'done' || task.status === 'failed';
}

export function normalizeRouteDecision(value: unknown): CoordinatorRouteDecision | null {
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

  return compactRecord<CoordinatorRouteDecision>({
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
  });
}

export function routeDecisionFromRuntimePayload(
  payload: Record<string, unknown>,
): CoordinatorRouteDecision | null {
  return (
    normalizeRouteDecision(payload.structuredOutput) ??
    normalizeRouteDecision(payload.structured_output) ??
    normalizeRouteDecision(payload.routeDecision) ??
    normalizeRouteDecision(payload.route_decision) ??
    normalizeRouteDecision(payload.decision) ??
    normalizeRouteDecision(payload)
  );
}

export function getTeamRouteContext(task: AgentTask): TeamRouteContext | null {
  const data = task.dispatchPayload ?? {};
  const modelParams = parseRecord(data.model_params);
  const nested = parseRecord(modelParams.agenthub_team_context);
  const teamId = getFirstString(data.team_id, data.teamId, nested.team_id, nested.teamId);
  const teamRunId = getFirstString(
    data.team_run_id,
    data.teamRunId,
    nested.team_run_id,
    nested.teamRunId,
  );
  if (!teamId || !teamRunId) return null;
  return compactRecord<TeamRouteContext>({
    teamId,
    teamRunId,
    teamMemberRole: getFirstString(
      data.team_member_role,
      data.teamMemberRole,
      nested.team_member_role,
      nested.teamMemberRole,
    ),
  });
}

export function routeDecisionKey(taskId: string, decision: CoordinatorRouteDecision): string {
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

export function parsePermissionDecisionControl(
  payload: unknown,
): EdgePermissionDecisionControl | null {
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

  return compactRecord<EdgePermissionDecisionControl>({
    runId,
    requestId,
    decision,
    reason: getFirstString(source.reason, data.reason),
  });
}

export function permissionDecisionControlKey(control: EdgePermissionDecisionControl): string {
  return [control.runId, control.requestId, control.decision, control.reason ?? ''].join('\u001f');
}

export function validateDispatchTarget(
  data: Record<string, unknown>,
  dispatchTarget: HubDispatchTarget | null | undefined,
): string | null {
  if (!dispatchTarget) return null;

  const targetId = getFirstString(data.target_id, data.targetId);
  const edgeDeviceId = getFirstString(data.edge_device_id, data.edgeDeviceId);
  if (targetId === dispatchTarget.targetId && edgeDeviceId === dispatchTarget.deviceId) {
    return null;
  }

  return `Dispatch target mismatch: expected ${dispatchTarget.targetId} for device ${dispatchTarget.deviceId}`;
}

export function buildDispatchTargetBinding(
  data: Record<string, unknown>,
  dispatchTarget: HubDispatchTarget | null | undefined,
): DispatchTargetBindingEvidence | null {
  if (!dispatchTarget) return null;
  const observedTargetId = getFirstString(data.target_id, data.targetId);
  const observedEdgeDeviceId = getFirstString(data.edge_device_id, data.edgeDeviceId);
  const status =
    observedTargetId === dispatchTarget.targetId && observedEdgeDeviceId === dispatchTarget.deviceId
      ? 'matched'
      : 'mismatch';

  return compactRecord<DispatchTargetBindingEvidence>({
    expectedTargetId: dispatchTarget.targetId,
    observedTargetId,
    expectedEdgeDeviceId: dispatchTarget.deviceId,
    observedEdgeDeviceId,
    status,
  });
}

export function bindDispatchPayload(
  data: Record<string, unknown>,
  binding: DispatchTargetBindingEvidence | null,
): Record<string, unknown> {
  if (!binding) return data;
  return {
    ...data,
    target_binding: compactRecord<Record<string, unknown>>({
      expected_target_id: binding.expectedTargetId,
      observed_target_id: binding.observedTargetId,
      expected_edge_device_id: binding.expectedEdgeDeviceId,
      observed_edge_device_id: binding.observedEdgeDeviceId,
      status: binding.status,
    }),
  };
}

export function normalizeRuntimeAgentId(agentId: string): string {
  const key = agentId.trim().toLowerCase();
  if (!key) return '';
  if (key === 'claude' || key.includes('claude-code') || key.includes('claude'))
    return 'claude-code';
  if (key.includes('opencode')) return 'opencode';
  if (key.includes('codex') || key.includes('gpt')) return 'codex';
  return key;
}

export function buildEdgeRunBody(
  data: Record<string, unknown>,
  threadId: string,
  prompt: string,
  agentId: string,
  targetBinding: DispatchTargetBindingEvidence | null,
): Record<string, unknown> {
  const modelParams = parseRecord(data.model_params);
  const allowedTools =
    parseStringArray(data.tool_whitelist) ??
    parseStringArray(modelParams.tool_allowlist) ??
    parseStringArray(modelParams.allowed_tools) ??
    parseStringArray(modelParams.allowedTools);

  return compactRecord<Record<string, unknown>>({
    threadId,
    prompt: prompt || undefined,
    agentId: agentId || undefined,
    model: getFirstString(modelParams.model, data.model),
    reasoningEffort: getFirstString(
      modelParams.reasoning_effort,
      modelParams.reasoningEffort,
      data.reasoning_effort,
      data.reasoningEffort,
    ),
    thinkingMode: getFirstString(
      modelParams.thinking_mode,
      modelParams.thinkingMode,
      data.thinking_mode,
      data.thinkingMode,
    ),
    maxThinkingTokens: getFirstNumber(
      modelParams.max_thinking_tokens,
      modelParams.maxThinkingTokens,
      data.max_thinking_tokens,
      data.maxThinkingTokens,
    ),
    permissionMode: getFirstString(
      modelParams.permission_mode,
      modelParams.permissionMode,
      data.permission_mode,
      data.permissionMode,
    ),
    workDir: getFirstString(modelParams.work_dir, modelParams.workDir, data.work_dir, data.workDir),
    includePartial: getFirstBoolean(
      modelParams.include_partial,
      modelParams.includePartial,
      data.include_partial,
      data.includePartial,
    ),
    structuredOutputSchema: getFirstString(
      modelParams.structured_output_schema,
      modelParams.structuredOutputSchema,
      data.structured_output_schema,
      data.structuredOutputSchema,
    ),
    systemPrompt: getFirstString(
      data.system_prompt,
      data.systemPrompt,
      modelParams.system_prompt,
      modelParams.systemPrompt,
    ),
    appendSystemPrompt: getFirstString(
      modelParams.append_system_prompt,
      modelParams.appendSystemPrompt,
      data.append_system_prompt,
      data.appendSystemPrompt,
    ),
    allowedTools,
    configOverrides:
      parseStringRecord(modelParams.config_overrides) ??
      parseStringRecord(modelParams.configOverrides),
    ephemeral: getFirstBoolean(modelParams.ephemeral, data.ephemeral),
    hubTaskId: getFirstString(data.task_id),
    targetId: targetBinding?.expectedTargetId,
    edgeDeviceId: targetBinding?.expectedEdgeDeviceId,
    dispatchTargetEvidence: targetBinding
      ? {
          expectedTargetId: targetBinding.expectedTargetId,
          observedTargetId: targetBinding.observedTargetId,
          expectedEdgeDeviceId: targetBinding.expectedEdgeDeviceId,
          observedEdgeDeviceId: targetBinding.observedEdgeDeviceId,
          targetStatus: targetBinding.status,
        }
      : undefined,
  });
}

export function extractRunOutputBatch(payload: Record<string, unknown>): string {
  if (payload.stream !== 'stdout' || !Array.isArray(payload.chunks)) return '';
  return payload.chunks
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object') return '';
      const text = (chunk as Record<string, unknown>).text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

export function extractCreatedRunId(value: unknown): string {
  const root = parseRecord(value);
  const isEnvelope =
    typeof root.code === 'string' && Object.prototype.hasOwnProperty.call(root, 'data');
  const run = isEnvelope ? parseRecord(root.data) : root;
  const runId = getFirstString(run.id, run.runId);
  if (!runId) {
    throw new Error(`Edge run created but no id/runId in response${isEnvelope ? ' data' : ''}`);
  }
  return runId;
}

export const FINAL_OUTPUT_MAX_CHARS = 32_000;

/**
 * Result of parsing a potential relay command frame.
 * - `isRelay`: true when the frame carries a relay_command_id
 * - `data`: the unwrapped dispatch payload (parsed from inner `payload` string for relay frames, or the raw frame for direct dispatches)
 * - `relayCommandId`: the relay command id when isRelay is true
 */
interface RelayFrameParseResult {
  isRelay: boolean;
  data: Record<string, unknown>;
  relayCommandId: string | null;
}

/**
 * Parse an agent.dispatch WS frame that may be a relay command wrapper.
 * Returns null when the frame is structurally invalid (missing task_id after unwrap).
 *
 * Relay frames have shape: { relay_command_id, command_type, payload: "<json-string>" }
 * Direct dispatches have shape: { task_id, target_id, edge_device_id, ... }
 */
export function parseDispatchFrame(raw: Record<string, unknown>): RelayFrameParseResult | null {
  const relayCommandId = typeof raw.relay_command_id === 'string' ? raw.relay_command_id : null;

  let data: Record<string, unknown>;
  if (relayCommandId) {
    const innerPayload = typeof raw.payload === 'string' ? raw.payload : null;
    if (!innerPayload) return null;
    try {
      data = JSON.parse(innerPayload) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else {
    data = raw;
  }

  if (typeof data.task_id !== 'string' || !data.task_id) return null;

  return { isRelay: !!relayCommandId, data, relayCommandId };
}
