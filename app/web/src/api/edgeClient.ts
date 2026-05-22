import { parseError } from '@shared/errors';
import type { HealthResponse, ListResponse, Runner, RunInfo } from '@shared/types';
import { EDGE_URL } from '@/config';

export type EdgeClientOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export interface ProjectResource {
  projectId: string;
  name?: string;
  path?: string;
  status?: string;
}

export interface ThreadResource {
  threadId: string;
  projectId?: string;
  title?: string;
  status?: string;
  updatedAt?: string;
}

export interface ThreadItemResource {
  itemId: string;
  threadId?: string;
  type?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectListOptions {
  pageSize?: number;
  pageCursor?: string;
}

export interface ThreadListOptions extends ProjectListOptions {
  projectId?: string;
}

export interface RunListOptions extends ProjectListOptions {
  threadId?: string;
}

export interface EdgeClient {
  fetchHealth(): Promise<HealthResponse>;
  fetchProjects(options?: ProjectListOptions): Promise<ListResponse<ProjectResource>>;
  fetchThreads(options?: ThreadListOptions): Promise<ListResponse<ThreadResource>>;
  fetchThreadItems(threadId: string, options?: ProjectListOptions): Promise<ListResponse<ThreadItemResource>>;
  fetchItem(itemId: string): Promise<ThreadItemResource>;
  fetchRunners(): Promise<ListResponse<Runner>>;
  fetchRuns(options?: RunListOptions): Promise<ListResponse<RunInfo>>;
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
    fetchProjects: (options) => request<ListResponse<ProjectResource>>(withQuery('/v1/projects', options)),
    fetchThreads: (options) => request<ListResponse<ThreadResource>>(withQuery('/v1/threads', options)),
    fetchThreadItems: (threadId, options) =>
      request<ListResponse<ThreadItemResource>>(
        withQuery(`/v1/threads/${encodeURIComponent(threadId)}/items`, options),
      ),
    fetchItem: (itemId) => request<ThreadItemResource>(`/v1/items/${encodeURIComponent(itemId)}`),
    fetchRunners: () => request<ListResponse<Runner>>('/v1/runners'),
    fetchRuns: (options) => request<ListResponse<RunInfo>>(withQuery('/v1/runs', options)),
    startRun: () => request<RunInfo>('/v1/runs', { method: 'POST' }),
    cancelRun: (runId: string) =>
      request<RunInfo>(`/v1/runs/${encodeURIComponent(runId)}:cancel`, { method: 'POST' }),
  };
}

function withQuery(path: string, params: URLSearchParams | ProjectListOptions | ThreadListOptions | RunListOptions = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export const edgeClient = createEdgeClient();
