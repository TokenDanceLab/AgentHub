import type { WorkbenchAgent } from '@shared/platform';
import type { AgentInfo } from '@shared/types';
import type { ModelCatalogResponse } from '@/api/edgeClient';

/**
 * Product runtime inventory for Local Edge.
 *
 * Product SSOT is Runtime inventory (agents/models/adapters) + Execution Target health.
 * Edge `/v1/runners` may still appear as optional diagnostic metadata only — never as the
 * healthy-signal source for Desktop dispatch readiness.
 */
export interface EdgeRuntimeInventorySnapshot {
  edgeOnline: boolean;
  healthStatus?: string;
  /**
   * Optional Edge diagnostics residual from health.checks.runners / `/v1/runners`.
   * Not used for product healthy status.
   */
  diagnosticRunners?: Array<{
    id: string;
    name?: string;
    status: string;
    capabilities?: string[];
  }>;
  agents: AgentInfo[];
  modelCatalog?: ModelCatalogResponse | undefined;
}

export interface DesktopExecutionTarget {
  id: 'local-edge';
  type: 'local_edge';
  name: 'Local Edge';
  status: 'healthy' | 'degraded' | 'offline' | 'unknown';
  route: 'local-edge-api';
  agentCount: number;
  modelCount: number;
  capabilityIds: string[];
}

type DesktopEdgeDispatchDisabledReason =
  | 'signed-out'
  | 'hub-targets-loading'
  | 'hub-targets-error'
  | 'missing-device'
  | 'local-edge-offline'
  | 'hub-target-pagination-limited'
  | 'missing-local-edge-target'
  | 'local-edge-target-mismatch'
  | 'local-edge-target-offline'
  | 'local-edge-target-degraded'
  | 'local-edge-target-unknown'
  | 'local-edge-health-degraded'
  | 'local-edge-health-unknown'
  | 'host-preflight-blocked';

interface DesktopEdgeRegisteredTargetSnapshot {
  id: string;
  name?: string;
  device_id?: string | null;
  target_type?: string;
  health_state?: string;
  is_online?: boolean;
}

interface DesktopEdgeHostReadinessSnapshot {
  health_url?: string;
  store_db_policy?: string;
  log_paths?: {
    directory?: string;
    stdout?: string;
    stderr?: string;
  };
  preflight?: {
    status?: string;
    blocker?: string | null;
  };
  direct_cli_spawn?: boolean;
}

interface DesktopEdgeDispatchReadinessInput {
  hubSessionActive: boolean;
  deviceId?: string | null;
  edgeOnline: boolean;
  localEdgeTarget: DesktopExecutionTarget;
  registeredLocalEdgeTarget?: DesktopEdgeRegisteredTargetSnapshot | null;
  hubTargetsLoading?: boolean;
  hubTargetsError?: boolean;
  hubTargetsPaginationLimited?: boolean;
  hostReadiness?: DesktopEdgeHostReadinessSnapshot | null;
}

interface DesktopEdgeDispatchReadiness {
  dispatchReady: boolean;
  disabledReason: DesktopEdgeDispatchDisabledReason | null;
  dispatchTarget: { targetId: string; deviceId: string } | null;
  targetBinding: DesktopEdgeTargetBindingEvidence;
  route: 'local-edge-api';
  targetType: 'local_edge';
  targetId: string | null;
  targetName: string | null;
  deviceId: string | null;
  localEdgeStatus: DesktopExecutionTarget['status'];
  hubTargetHealthState: string | null;
  hubTargetOnline: boolean | null;
  healthUrl: string | null;
  preflightStatus: string | null;
  preflightBlocker: string | null;
  storeDbPolicy: string | null;
  logPaths: {
    directory: string | null;
    stdout: string | null;
    stderr: string | null;
  };
  directCliSpawn: false;
}

interface DesktopEdgeTargetBindingEvidence {
  expectedTargetId: string | null;
  observedTargetId: string | null;
  expectedEdgeDeviceId: string | null;
  observedEdgeDeviceId: string | null;
  status: 'matched' | 'mismatch' | 'offline' | 'missing';
}

export function mapEdgeAgentsToWorkbenchAgents(
  agents: AgentInfo[],
  modelCatalog?: ModelCatalogResponse,
): WorkbenchAgent[] {
  return agents.map((agent) => {
    const model = selectModelForAgent(agent, modelCatalog);
    return {
      id: agent.id,
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {}),
      status: agent.status,
      runtimeId: agent.runtimeId ?? agent.id,
      ...((agent.provider ?? model?.provider)
        ? { provider: agent.provider ?? model?.provider }
        : {}),
      ...((agent.model ?? model?.value) ? { model: agent.model ?? model?.value } : {}),
      ...(agent.approvalPolicy ? { approvalPolicy: agent.approvalPolicy } : {}),
      ...(agent.permissionMode ? { permissionMode: agent.permissionMode } : {}),
      ...(agent.reasoningEffort ? { reasoningEffort: agent.reasoningEffort } : {}),
      skills: capabilityLabels(agent.capabilities),
      ...(agent.toolAllowlist ? { toolAllowlist: agent.toolAllowlist } : {}),
    };
  });
}

export function mapLocalEdgeExecutionTarget(
  snapshot: EdgeRuntimeInventorySnapshot,
): DesktopExecutionTarget {
  const agentCount = snapshot.agents.length;
  const modelCount = snapshot.modelCatalog?.items.length ?? 0;
  return {
    id: 'local-edge',
    type: 'local_edge',
    name: 'Local Edge',
    status: normalizeLocalEdgeStatus(
      snapshot.edgeOnline,
      snapshot.healthStatus,
      agentCount,
      modelCount,
    ),
    route: 'local-edge-api',
    agentCount,
    modelCount,
    capabilityIds: Array.from(
      new Set(snapshot.agents.flatMap((agent) => capabilityLabels(agent.capabilities))),
    ).sort(),
  };
}

export function resolveDesktopEdgeDispatchReadiness(
  input: DesktopEdgeDispatchReadinessInput,
): DesktopEdgeDispatchReadiness {
  const target = input.registeredLocalEdgeTarget ?? null;
  const deviceId = input.deviceId?.trim() || null;
  const base = buildDispatchReadiness(input, null);

  if (!input.hubSessionActive) return buildDispatchReadiness(input, 'signed-out');
  if (input.hubTargetsLoading) return buildDispatchReadiness(input, 'hub-targets-loading');
  if (input.hubTargetsError) return buildDispatchReadiness(input, 'hub-targets-error');
  if (!deviceId) return buildDispatchReadiness(input, 'missing-device');
  if (!input.edgeOnline) return buildDispatchReadiness(input, 'local-edge-offline');
  if (input.hubTargetsPaginationLimited)
    return buildDispatchReadiness(input, 'hub-target-pagination-limited');
  if (!target) return buildDispatchReadiness(input, 'missing-local-edge-target');
  if (target.target_type !== 'local_edge' || target.device_id !== deviceId) {
    return buildDispatchReadiness(input, 'local-edge-target-mismatch');
  }
  if (target.is_online !== true || target.health_state === 'offline') {
    return buildDispatchReadiness(input, 'local-edge-target-offline');
  }
  if (target.health_state === 'degraded')
    return buildDispatchReadiness(input, 'local-edge-target-degraded');
  if (target.health_state !== 'healthy')
    return buildDispatchReadiness(input, 'local-edge-target-unknown');
  if (input.localEdgeTarget.status === 'degraded')
    return buildDispatchReadiness(input, 'local-edge-health-degraded');
  if (input.localEdgeTarget.status !== 'healthy')
    return buildDispatchReadiness(input, 'local-edge-health-unknown');
  if (input.hostReadiness?.preflight?.status === 'blocked')
    return buildDispatchReadiness(input, 'host-preflight-blocked');

  return {
    ...base,
    dispatchReady: true,
    dispatchTarget: {
      targetId: target.id,
      deviceId,
    },
  };
}

export function formatDesktopEdgeDispatchDiagnostics(
  readiness: DesktopEdgeDispatchReadiness | null | undefined,
): string | null {
  if (!readiness) return null;
  return [
    'Local Edge dispatch',
    `  dispatch ready: ${readiness.dispatchReady}`,
    readiness.disabledReason ? `  dispatch disabled reason: ${readiness.disabledReason}` : null,
    `  route: ${readiness.route}`,
    `  target type: ${readiness.targetType}`,
    `  target id: ${readiness.targetId ?? 'n/a'}`,
    readiness.targetName ? `  target name: ${readiness.targetName}` : null,
    `  device id: ${readiness.deviceId ?? 'n/a'}`,
    `  target binding: ${readiness.targetBinding.status}`,
    `  local edge status: ${readiness.localEdgeStatus}`,
    `  hub target health: ${readiness.hubTargetHealthState ?? 'n/a'}`,
    `  hub target online: ${readiness.hubTargetOnline ?? 'n/a'}`,
    `  health: ${readiness.healthUrl ?? 'n/a'}`,
    `  preflight: ${readiness.preflightStatus ?? 'n/a'}`,
    readiness.preflightBlocker ? `  preflight blocker: ${readiness.preflightBlocker}` : null,
    `  store: ${readiness.storeDbPolicy ?? 'n/a'}`,
    `  logs: ${readiness.logPaths.directory ?? 'n/a'}`,
    `  stdout: ${readiness.logPaths.stdout ?? 'n/a'}`,
    `  stderr: ${readiness.logPaths.stderr ?? 'n/a'}`,
    `  direct cli spawn: ${readiness.directCliSpawn}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function selectModelForAgent(
  agent: AgentInfo,
  modelCatalog?: ModelCatalogResponse,
): ModelCatalogResponse['items'][number] | undefined {
  if (!modelCatalog?.items.length) return undefined;
  const runtimeId = agent.runtimeId ?? agent.id;
  const runtimeMatches = modelCatalog.items.filter(
    (item) =>
      item.runtimeId === runtimeId ||
      item.sourceId === runtimeId ||
      (agent.provider && item.provider === agent.provider),
  );
  return (
    runtimeMatches.find((item) => item.default) ??
    runtimeMatches[0] ??
    modelCatalog.items.find((item) => item.default)
  );
}

function capabilityLabels(capabilities: AgentInfo['capabilities']): string[] {
  const labels: string[] = [];
  if (capabilities.streaming) labels.push('streaming');
  if (capabilities.toolCalls) labels.push('tool-calls');
  if (capabilities.fileChanges) labels.push('file-changes');
  if (capabilities.thinkingVisible) labels.push('thinking-visible');
  if (capabilities.multiTurn) labels.push('multi-turn');
  if (capabilities.mcpIntegration) labels.push('mcp');
  if (capabilities.permissionHooks) labels.push('permission-hooks');
  if (capabilities.subAgentSpawn) labels.push('sub-agent-spawn');
  return labels;
}

/**
 * Product local-edge status from connectivity + Edge health + runtime inventory.
 * Never infers healthy solely from Edge runner diagnostics.
 */
function normalizeLocalEdgeStatus(
  edgeOnline: boolean,
  healthStatus: string | undefined,
  agentCount: number,
  modelCount: number,
): DesktopExecutionTarget['status'] {
  if (!edgeOnline) return 'offline';
  const normalized = (healthStatus ?? '').trim().toLowerCase();
  if (normalized === 'healthy' || normalized === 'ok') return 'healthy';
  if (normalized === 'degraded') return 'degraded';
  if (normalized === 'offline') return 'offline';
  // Online without explicit healthy status: runtime inventory is evidence of
  // partial readiness, not a healthy product signal.
  if (agentCount > 0 || modelCount > 0) return 'degraded';
  return 'unknown';
}

function buildDispatchReadiness(
  input: DesktopEdgeDispatchReadinessInput,
  disabledReason: DesktopEdgeDispatchDisabledReason | null,
): DesktopEdgeDispatchReadiness {
  const target = input.registeredLocalEdgeTarget ?? null;
  const deviceId = input.deviceId?.trim() || null;
  return {
    dispatchReady: false,
    disabledReason,
    dispatchTarget: null,
    targetBinding: resolveTargetBinding(input, disabledReason),
    route: 'local-edge-api',
    targetType: 'local_edge',
    targetId: target?.id ?? null,
    targetName: target?.name ?? null,
    deviceId,
    localEdgeStatus: input.localEdgeTarget.status,
    hubTargetHealthState: target?.health_state ?? null,
    hubTargetOnline: typeof target?.is_online === 'boolean' ? target.is_online : null,
    healthUrl: input.hostReadiness?.health_url ?? null,
    preflightStatus: input.hostReadiness?.preflight?.status ?? null,
    preflightBlocker: input.hostReadiness?.preflight?.blocker ?? null,
    storeDbPolicy: input.hostReadiness?.store_db_policy ?? null,
    logPaths: {
      directory: input.hostReadiness?.log_paths?.directory ?? null,
      stdout: input.hostReadiness?.log_paths?.stdout ?? null,
      stderr: input.hostReadiness?.log_paths?.stderr ?? null,
    },
    directCliSpawn: false,
  };
}

function resolveTargetBinding(
  input: DesktopEdgeDispatchReadinessInput,
  disabledReason: DesktopEdgeDispatchDisabledReason | null,
): DesktopEdgeTargetBindingEvidence {
  const target = input.registeredLocalEdgeTarget ?? null;
  const deviceId = input.deviceId?.trim() || null;
  const expectedTargetId = target?.id ?? null;
  const observedTargetId = target?.id ?? null;
  const expectedEdgeDeviceId = deviceId;
  const observedEdgeDeviceId = target?.device_id ?? null;

  const identityMatches = Boolean(
    expectedTargetId &&
    expectedEdgeDeviceId &&
    observedTargetId === expectedTargetId &&
    observedEdgeDeviceId === expectedEdgeDeviceId,
  );
  const status: DesktopEdgeTargetBindingEvidence['status'] = (() => {
    if (!expectedTargetId || !expectedEdgeDeviceId || !observedTargetId || !observedEdgeDeviceId) {
      return 'missing';
    }
    if (!identityMatches) return 'mismatch';
    if (
      disabledReason === 'local-edge-offline' ||
      disabledReason === 'local-edge-target-offline' ||
      disabledReason === 'local-edge-target-degraded' ||
      disabledReason === 'local-edge-target-unknown' ||
      disabledReason === 'local-edge-health-degraded' ||
      disabledReason === 'local-edge-health-unknown' ||
      disabledReason === 'host-preflight-blocked'
    ) {
      return 'offline';
    }
    return 'matched';
  })();

  return {
    expectedTargetId,
    observedTargetId,
    expectedEdgeDeviceId,
    observedEdgeDeviceId,
    status,
  };
}
