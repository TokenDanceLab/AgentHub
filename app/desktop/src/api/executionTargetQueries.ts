import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from './hubClient';
import type {
  CreateExecutionTargetRequest,
  ExecutionTarget,
  ExecutionTargetHealthState,
  ExecutionTargetListResponse,
  ExecutionTargetTrustLevel,
  ExecutionTargetType,
} from './hubClient';
import type { DesktopExecutionTarget } from '@/platform/edgeCapabilityMapper';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { hubQueryKeys } from '@shared/stores/queryKeys';

export interface UseHubExecutionTargetsOptions {
  enabled: boolean;
  getToken?: () => string | null;
  baseUrl?: string;
}

export interface ExecutionTargetInventoryItem
  extends Omit<ExecutionTarget, 'health_state' | 'is_online' | 'target_type' | 'trust_level' | 'workspace_allowlist'> {
  target_type: ExecutionTargetType;
  workspace_allowlist: string[];
  trust_level: ExecutionTargetTrustLevel;
  health_state: ExecutionTargetHealthState;
  is_online: boolean;
}

export interface ExecutionTargetInventorySummary {
  total: number;
  online: number;
  healthy: number;
  degraded: number;
  offline: number;
  unknown: number;
  byType: Record<ExecutionTargetType, number>;
}

interface SyncLocalEdgeExecutionTargetInput {
  deviceId: string;
  localEdgeTarget: DesktopExecutionTarget;
  registeredTargetId?: string;
}

interface ExecutionTargetInventoryResponse {
  items: ExecutionTargetInventoryItem[];
  page: ExecutionTargetListResponse['page'];
}

const executionTargetTypes: ExecutionTargetType[] = [
  'local_edge',
  'hub_relay',
  'remote_ssh',
  'tailscale',
  'cloud_edge',
];

const trustLevels: ExecutionTargetTrustLevel[] = ['local', 'remote', 'cloud', 'relay'];
// #1544: health states projected from evidence — online (fresh proof),
// stale (expired evidence window), mismatch (observed identity disagrees),
// registered (bound but not yet proven live). Keep them in the pass-through
// list so the UI shows the real state instead of collapsing to unknown.
const healthStates: ExecutionTargetHealthState[] = ['unknown', 'online', 'healthy', 'degraded', 'offline', 'stale', 'mismatch', 'registered'];

const emptyExecutionTargets: ExecutionTargetInventoryResponse = {
  items: [],
  page: { hasMore: false },
};
const executionTargetPageSize = 50;
const maxExecutionTargetPages = 10;

function parseWorkspaceAllowlist(value: ExecutionTarget['workspace_allowlist']): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  }
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      : [];
  } catch {
    return [];
  }
}

function normalizeTargetType(value: string | undefined): ExecutionTargetType {
  return executionTargetTypes.includes(value as ExecutionTargetType) ? value as ExecutionTargetType : 'local_edge';
}

function normalizeTrustLevel(value: string | undefined): ExecutionTargetTrustLevel {
  return trustLevels.includes(value as ExecutionTargetTrustLevel) ? value as ExecutionTargetTrustLevel : 'local';
}

function normalizeHealthState(value: string | undefined): ExecutionTargetHealthState {
  return healthStates.includes(value as ExecutionTargetHealthState) ? value as ExecutionTargetHealthState : 'unknown';
}

function normalizeExecutionTarget(target: ExecutionTarget): ExecutionTargetInventoryItem {
  return {
    ...target,
    target_type: normalizeTargetType(target.target_type),
    workspace_allowlist: parseWorkspaceAllowlist(target.workspace_allowlist),
    trust_level: normalizeTrustLevel(target.trust_level),
    health_state: normalizeHealthState(target.health_state),
    is_online: target.is_online === true,
  };
}

export async function fetchExecutionTargets(
  preferHub: boolean,
  getToken: () => string | null = getAccessToken,
  baseUrl?: string,
): Promise<ExecutionTargetInventoryResponse> {
  const token = getToken();
  if (!preferHub || !token) return emptyExecutionTargets;

  const client = createHubClient(
    baseUrl ? { baseUrl, getToken: () => token } : { getToken: () => token },
  );
  const items: ExecutionTargetInventoryItem[] = [];
  let page: ExecutionTargetListResponse['page'] = { hasMore: false };
  let pageCursor: string | undefined;

  for (let i = 0; i < maxExecutionTargetPages; i += 1) {
    const res = await client.listExecutionTargets({
      pageSize: executionTargetPageSize,
      ...(pageCursor ? { pageCursor } : {}),
    });
    items.push(...res.items.map(normalizeExecutionTarget));
    page = res.page ?? { hasMore: false };
    if (!page.hasMore || !page.nextCursor) {
      return { items, page };
    }
    pageCursor = page.nextCursor;
  }

  return {
    items,
    page: { ...page, hasMore: true },
  };
}

export function summarizeExecutionTargets(targets: ExecutionTargetInventoryItem[]): ExecutionTargetInventorySummary {
  const byType = executionTargetTypes.reduce<Record<ExecutionTargetType, number>>((acc, type) => {
    acc[type] = 0;
    return acc;
  }, {} as Record<ExecutionTargetType, number>);

  let online = 0;
  let healthy = 0;
  let degraded = 0;
  let offline = 0;
  let unknown = 0;

  for (const target of targets) {
    byType[String(target.target_type) as ExecutionTargetType] = (byType[String(target.target_type) as ExecutionTargetType] ?? 0) + 1;
    if (target.is_online) online += 1;
    if (target.health_state === 'healthy' || target.health_state === 'online') healthy += 1;
    else if (target.health_state === 'degraded') degraded += 1;
    else if (target.health_state === 'offline') offline += 1;
    else unknown += 1;
  }

  return {
    total: targets.length,
    online,
    healthy,
    degraded,
    offline,
    unknown,
    byType,
  };
}

export function findRegisteredLocalEdgeTarget(
  targets: ExecutionTargetInventoryItem[],
  deviceId: string | null | undefined,
): ExecutionTargetInventoryItem | null {
  if (!deviceId) return null;
  return targets.find((target) => target.target_type === 'local_edge' && target.device_id === deviceId) ?? null;
}

export function useHubExecutionTargets(enabledOrOptions: boolean | UseHubExecutionTargetsOptions) {
  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const options = typeof enabledOrOptions === 'boolean'
    ? { enabled: enabledOrOptions, preferHub: hubAuthenticated, getToken: getAccessToken }
    : {
        enabled: enabledOrOptions.enabled,
        preferHub: enabledOrOptions.enabled,
        getToken: enabledOrOptions.getToken ?? getAccessToken,
        baseUrl: enabledOrOptions.baseUrl,
      };

  return useQuery<ExecutionTargetInventoryResponse>({
    queryKey: [
      ...hubQueryKeys.executionTargets.list(options.preferHub ? 'hub' : 'signed-out'),
      options.baseUrl ?? 'default',
    ],
    queryFn: () => fetchExecutionTargets(options.preferHub, options.getToken, options.baseUrl),
    enabled: options.enabled,
    refetchInterval: options.preferHub ? 10_000 : false,
    placeholderData: (prev) => prev,
  });
}

export function usePingHubExecutionTarget(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetId: string) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        options.baseUrl
          ? { baseUrl: options.baseUrl, getToken: () => token }
          : { getToken: () => token },
      );
      await client.pingExecutionTarget(targetId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.executionTargets.root });
    },
  });
}

function buildLocalEdgeTargetPayload(
  deviceId: string,
  localEdgeTarget: DesktopExecutionTarget,
): CreateExecutionTargetRequest {
  return {
    name: 'AgentHub Desktop Local Edge',
    target_type: 'local_edge',
    device_id: deviceId,
    trust_level: 'local',
    auth_method: 'hub_jwt',
    workspace_allowlist: [],
    // Product SSOT for Local Edge readiness is Runtime inventory + Execution Target health.
    // Do not publish Edge runner diagnostics as Hub target capability inventory.
    capabilities: {
      route: localEdgeTarget.route,
      agent_count: localEdgeTarget.agentCount,
      model_count: localEdgeTarget.modelCount,
      capability_ids: localEdgeTarget.capabilityIds,
      runtime_inventory: 'agents-models',
    },
    metadata: {
      source: 'agenthub-desktop',
      registration: 'desktop-local-edge-readiness',
      target_id: localEdgeTarget.id,
      status: localEdgeTarget.status,
    },
  };
}

export function useSyncLocalEdgeExecutionTarget(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ deviceId, localEdgeTarget, registeredTargetId }: SyncLocalEdgeExecutionTargetInput) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      if (!deviceId) throw new Error('Desktop device id is required');
      const client = createHubClient(
        options.baseUrl
          ? { baseUrl: options.baseUrl, getToken: () => token }
          : { getToken: () => token },
      );
      const payload = buildLocalEdgeTargetPayload(deviceId, localEdgeTarget);
      if (registeredTargetId) {
        await client.updateExecutionTarget(registeredTargetId, payload);
        return;
      }
      await client.createExecutionTarget(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.executionTargets.root });
    },
  });
}
