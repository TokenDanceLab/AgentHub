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
const healthStates: ExecutionTargetHealthState[] = ['unknown', 'healthy', 'degraded', 'offline'];

const emptyExecutionTargets: ExecutionTargetInventoryResponse = {
  items: [],
  page: { hasMore: false },
};

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
  const res = await client.listExecutionTargets({ pageSize: 50 });
  return {
    items: res.items.map(normalizeExecutionTarget),
    page: res.page,
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
    byType[target.target_type] += 1;
    if (target.is_online) online += 1;
    if (target.health_state === 'healthy') healthy += 1;
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
    queryKey: ['execution-targets', options.preferHub ? 'hub' : 'signed-out', options.baseUrl ?? 'default'],
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
      queryClient.invalidateQueries({ queryKey: ['execution-targets'] });
    },
  });
}
