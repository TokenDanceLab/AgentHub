import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from './hubClient';
import type {
  ExecutionTarget,
  ExecutionTargetHealthState,
  ExecutionTargetListResponse,
  ExecutionTargetTrustLevel,
  ExecutionTargetType,
} from './hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { hubQueryKeys } from '@shared/stores/queryKeys';

export interface UseHubExecutionTargetsOptions {
  enabled: boolean;
  getToken?: () => string | null;
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
  mismatch: number;
  stale: number;
  unknown: number;
  byType: Record<ExecutionTargetType, number>;
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
const healthStates: ExecutionTargetHealthState[] = [
  'unknown',
  'online',
  'healthy',
  'degraded',
  'offline',
  'stale',
  'mismatch',
  'registered',
];

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
): Promise<ExecutionTargetInventoryResponse> {
  const token = getToken();
  if (!preferHub || !token) return emptyExecutionTargets;

  const client = createHubClient({ getToken: () => token });
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
  let mismatch = 0;
  let stale = 0;
  let unknown = 0;

  for (const target of targets) {
    byType[String(target.target_type) as ExecutionTargetType] = (byType[String(target.target_type) as ExecutionTargetType] ?? 0) + 1;
    if (target.is_online) online += 1;
    if (target.health_state === 'healthy' || target.health_state === 'online') healthy += 1;
    else if (target.health_state === 'degraded') degraded += 1;
    else if (target.health_state === 'offline') offline += 1;
    else if (target.health_state === 'mismatch') mismatch += 1;
    else if (target.health_state === 'stale') stale += 1;
    else unknown += 1;
  }

  return {
    total: targets.length,
    online,
    healthy,
    degraded,
    offline,
    mismatch,
    stale,
    unknown,
    byType,
  };
}

export function useHubExecutionTargets(enabledOrOptions: boolean | UseHubExecutionTargetsOptions) {
  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const options = typeof enabledOrOptions === 'boolean'
    ? { enabled: enabledOrOptions, preferHub: hubAuthenticated, getToken: getAccessToken }
    : { enabled: enabledOrOptions.enabled, preferHub: enabledOrOptions.enabled, getToken: enabledOrOptions.getToken ?? getAccessToken };

  return useQuery<ExecutionTargetInventoryResponse>({
    queryKey: hubQueryKeys.executionTargets.list(options.preferHub ? 'hub' : 'signed-out'),
    queryFn: () => fetchExecutionTargets(options.preferHub, options.getToken),
    enabled: options.enabled,
    refetchInterval: options.preferHub ? 10_000 : false,
    placeholderData: (prev) => prev,
  });
}

export function usePingHubExecutionTarget(options: { getToken?: () => string | null } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetId: string) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient({ getToken: () => token });
      await client.pingExecutionTarget(targetId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.executionTargets.root });
    },
  });
}
