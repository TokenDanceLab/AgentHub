import type {
  HealthResponse,
  ListResponse,
  Project,
  ProjectMemory,
  Thread,
  ThreadItem,
  Message,
  Runner,
  Run,
  StartRunRequest,
  RunLogs,
  RunDiff,
  Approval,
  Artifact,
  Preview,
  Workspace,
  WorkspaceFile,
} from './types';
import { parseError } from './errors';

// ── Config ────────────────────────────────────

let baseUrl = '';

export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/+$/, '');
}

export function getBaseUrl() {
  return baseUrl;
}

export function isConfigured(): boolean {
  return baseUrl !== '';
}

// ── Internal fetch wrapper ────────────────────

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!baseUrl) {
    throw new Error('[AgentHub API] Base URL is not configured. Call setBaseUrl() before making API requests.');
  }
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  if (!baseUrl) {
    throw new Error('[AgentHub API] Base URL is not configured. Call setBaseUrl() before making API requests.');
  }
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
    },
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  return res.blob();
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ── Foundation ─────────────────────────────────

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/v1/health');
}

// ── Projects ──────────────────────────────────

export function listProjects(opts?: {
  pageSize?: number;
  pageCursor?: string;
}): Promise<ListResponse<Project>> {
  return request(`/v1/projects${qs(opts ?? {})}`);}

export function getProject(projectId: string): Promise<Project> {
  return request(`/v1/projects/${encodeURIComponent(projectId)}`);
}

export function createProject(body: {
  name: string;
  description?: string;
}): Promise<Project> {
  return request('/v1/projects', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getProjectMemory(
  projectId: string,
): Promise<ProjectMemory> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/memory`,
  );
}

// ── Threads ───────────────────────────────────

export function listThreads(opts?: {
  projectId?: string;
  pageSize?: number;
  pageCursor?: string;
}): Promise<ListResponse<Thread>> {
  return request(`/v1/threads${qs(opts ?? {})}`);
}

export function getThread(threadId: string): Promise<Thread> {
  return request(`/v1/threads/${encodeURIComponent(threadId)}`);
}

export function createThread(body: {
  projectId: string;
  title?: string;
}): Promise<Thread> {
  return request('/v1/threads', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateThread(
  threadId: string,
  body: { title?: string; status?: string },
): Promise<Thread> {
  return request(`/v1/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function archiveThread(threadId: string): Promise<Thread> {
  return request(
    `/v1/threads/${encodeURIComponent(threadId)}:archive`,
    { method: 'POST' },
  );
}

// ── Thread items ──────────────────────────────

export function listThreadItems(
  threadId: string,
  opts?: { pageSize?: number; pageCursor?: string },
): Promise<ListResponse<ThreadItem>> {
  return request(
    `/v1/threads/${encodeURIComponent(threadId)}/items${qs(opts ?? {})}`,
  );
}

export function createThreadMessage(
  threadId: string,
  body: { role: 'user'; content: string },
): Promise<Message> {
  return request(
    `/v1/threads/${encodeURIComponent(threadId)}/messages`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

// ── Runners ───────────────────────────────────

export function listRunners(): Promise<ListResponse<Runner>> {
  return request('/v1/runners');
}

export function getRunner(runnerId: string): Promise<Runner> {
  return request(`/v1/runners/${encodeURIComponent(runnerId)}`);
}

export function pingRunner(runnerId: string): Promise<Runner> {
  return request(
    `/v1/runners/${encodeURIComponent(runnerId)}:ping`,
    { method: 'POST' },
  );
}

// ── Runs ──────────────────────────────────────

export function listRuns(opts?: {
  threadId?: string;
  pageSize?: number;
  pageCursor?: string;
}): Promise<ListResponse<Run>> {
  return request(`/v1/runs${qs(opts ?? {})}`);
}

export function getRun(runId: string): Promise<Run> {
  return request(`/v1/runs/${encodeURIComponent(runId)}`);
}

export function startRun(body?: StartRunRequest): Promise<Run> {
  return request('/v1/runs', {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

export function cancelRun(runId: string): Promise<Run> {
  return request(
    `/v1/runs/${encodeURIComponent(runId)}:cancel`,
    { method: 'POST' },
  );
}

export function listRunItems(
  runId: string,
): Promise<ListResponse<ThreadItem>> {
  return request(
    `/v1/runs/${encodeURIComponent(runId)}/items`,
  );
}

export function getRunLogs(runId: string): Promise<RunLogs> {
  return request(`/v1/runs/${encodeURIComponent(runId)}/logs`);
}

export function getRunDiff(runId: string): Promise<RunDiff> {
  return request(`/v1/runs/${encodeURIComponent(runId)}/diff`);
}

// ── Approvals ─────────────────────────────────

export function listApprovals(): Promise<ListResponse<Approval>> {
  return request('/v1/approvals');
}

export function getApproval(approvalId: string): Promise<Approval> {
  return request(
    `/v1/approvals/${encodeURIComponent(approvalId)}`,
  );
}

export function decideApproval(
  approvalId: string,
  body: { decision: 'approved' | 'rejected' },
): Promise<Approval> {
  return request(
    `/v1/approvals/${encodeURIComponent(approvalId)}:decide`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

// ── Artifacts ─────────────────────────────────

export function listArtifacts(): Promise<ListResponse<Artifact>> {
  return request('/v1/artifacts');
}

export function getArtifact(artifactId: string): Promise<Artifact> {
  return request(
    `/v1/artifacts/${encodeURIComponent(artifactId)}`,
  );
}

export function getArtifactContent(
  artifactId: string,
): Promise<Blob> {
  return requestBlob(
    `/v1/artifacts/${encodeURIComponent(artifactId)}/content`,
  );
}

export function applyArtifact(artifactId: string): Promise<Artifact> {
  return request(
    `/v1/artifacts/${encodeURIComponent(artifactId)}:apply`,
    { method: 'POST' },
  );
}

export function discardArtifact(
  artifactId: string,
): Promise<Artifact> {
  return request(
    `/v1/artifacts/${encodeURIComponent(artifactId)}:discard`,
    { method: 'POST' },
  );
}

// ── Previews ──────────────────────────────────

export function listPreviews(): Promise<ListResponse<Preview>> {
  return request('/v1/previews');
}

export function getPreview(previewId: string): Promise<Preview> {
  return request(
    `/v1/previews/${encodeURIComponent(previewId)}`,
  );
}

export function createPreview(body: {
  runId: string;
}): Promise<Preview> {
  return request('/v1/previews', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Workspaces ────────────────────────────────

export function getWorkspace(
  workspaceId: string,
): Promise<Workspace> {
  return request(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}`,
  );
}

export function listWorkspaceFiles(
  workspaceId: string,
): Promise<ListResponse<WorkspaceFile>> {
  return request(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/files`,
  );
}

export function readWorkspaceFile(
  workspaceId: string,
  body: { path: string },
): Promise<{ path: string; content: string }> {
  return request(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/files:read`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}
