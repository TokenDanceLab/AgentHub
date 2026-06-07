import type { AgentInfo, HealthResponse, ListResponse } from '@shared/types';

export const webHubOnlyHealth: HealthResponse = {
  status: 'hub-only',
  version: 'web-preview',
  edgeId: 'web-hub-only',
  checks: {
    executor: {
      status: 'stubbed',
      message: 'Web connects through Hub and does not open a desktop runtime bridge.',
    },
    runners: {
      status: 'stubbed',
      message: 'Runtime readiness is reported by Hub Agent Profiles and registered execution targets.',
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
