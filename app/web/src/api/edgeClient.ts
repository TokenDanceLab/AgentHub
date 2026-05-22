import { parseError } from '@shared/errors';
import type { HealthResponse, ListResponse, Runner, RunInfo } from '@shared/types';
import { EDGE_URL } from '@/config';

export type EdgeClientOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export interface EdgeClient {
  fetchHealth(): Promise<HealthResponse>;
  fetchRunners(): Promise<ListResponse<Runner>>;
  startRun(): Promise<RunInfo>;
  cancelRun(runId: string): Promise<RunInfo>;
}

export function createEdgeClient(options: EdgeClientOptions = {}): EdgeClient {
  const base = (options.baseUrl ?? EDGE_URL).replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${base}${path}`;
    const res = init ? await fetcher(url, init) : await fetcher(url);
    if (!res.ok) throw await parseError(res);
    return res.json();
  }

  return {
    fetchHealth: () => request<HealthResponse>('/v1/health'),
    fetchRunners: () => request<ListResponse<Runner>>('/v1/runners'),
    startRun: () => request<RunInfo>('/v1/runs', { method: 'POST' }),
    cancelRun: (runId: string) =>
      request<RunInfo>(`/v1/runs/${encodeURIComponent(runId)}:cancel`, { method: 'POST' }),
  };
}

export const edgeClient = createEdgeClient();
