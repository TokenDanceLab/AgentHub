import type { AgentInfo, HealthResponse, ListResponse } from '@shared/types';

// Web never talks to Local Edge. Product health is Hub Execution Target inventory.
// Keep this stub free of runner-shaped product inventory.
export const webHubOnlyHealth: HealthResponse = {
  status: 'hub-only',
  version: 'web-preview',
  edgeId: 'web-hub-only',
  checks: {
    executor: {
      status: 'stubbed',
    },
    adapters: {
      status: 'hub-execution-target',
    },
  },
};

export async function fetchHealth(): Promise<HealthResponse> {
  return webHubOnlyHealth;
}

export async function fetchAgents(): Promise<ListResponse<AgentInfo>> {
  return {
    items: [],
    page: { hasMore: false },
  };
}
