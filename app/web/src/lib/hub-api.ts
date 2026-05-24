const HUB_URL = import.meta.env.VITE_HUB_URL || 'http://localhost:8080';

export interface HubHealth {
  status: string;
  version: string;
  uptime: string;
  checks: Record<string, unknown>;
}

export interface HubPublicStats {
  totalUsers: number;
  totalAgents: number;
  onlineAgents: number;
  totalMessages: number;
  uptime: string;
}

export interface HubStatsResponse {
  status: string;
  data: HubPublicStats;
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${HUB_URL}${path}`, { signal });
  if (!res.ok) {
    throw new Error(`Hub API ${path} returned ${res.status}`);
  }
  return res.json();
}

export function fetchHealth(signal?: AbortSignal): Promise<HubHealth> {
  return request<HubHealth>('/health', signal);
}

export function fetchStats(signal?: AbortSignal): Promise<HubStatsResponse> {
  return request<HubStatsResponse>('/api/public/stats', signal);
}
