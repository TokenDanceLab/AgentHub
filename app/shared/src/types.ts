// ── REST API types ──────────────────────────────

export interface HealthResponse {
  status: string;
  version: string;
  edgeId: string;
}

export interface Runner {
  id: string;
  name: string;
  status: string;
  capabilities?: string;
}

export interface PageInfo {
  nextCursor?: string;
  hasMore: boolean;
}

export interface ListResponse<T> {
  items: T[];
  page: PageInfo;
}

export interface RunInfo {
  runId: string;
  status: string;
  createdAt?: string;
}
