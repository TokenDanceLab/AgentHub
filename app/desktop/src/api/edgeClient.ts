// Edge REST API client
const EDGE_URL = 'http://127.0.0.1:3210';

export interface HealthResponse {
  status: string;
  version: string;
  edgeId: string;
}

export interface Runner {
  id: string;
  name: string;
  status: string;
}

export interface PageInfo {
  nextCursor?: string;
  hasMore: boolean;
}

export interface ListResponse<T> {
  items: T[];
  page: PageInfo;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${EDGE_URL}/v1/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchRunners(): Promise<ListResponse<Runner>> {
  const res = await fetch(`${EDGE_URL}/v1/runners`);
  if (!res.ok) {
    throw new Error(`Failed to fetch runners: ${res.status}`);
  }
  return res.json();
}
