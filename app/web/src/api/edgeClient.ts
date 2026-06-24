import type { AgentInfo, HealthResponse, ListResponse } from '@shared/types';

export const webHubOnlyHealth: HealthResponse = {
  status: 'hub-only',
  version: 'web-preview',
  edgeId: 'web-hub-only',
  checks: {
    executor: {
      status: 'stubbed',
    },
    runners: {
      status: 'stubbed',
      total: 0,
      available: 0,
      items: [],
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
