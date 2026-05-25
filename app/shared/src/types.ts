// Domain types mirroring api/openapi.yaml schemas and P0 resource shapes.
// Generic responses (ListResponse, PageInfo, ErrorResponse) match the OpenAPI
// components so the API client can reuse them for every endpoint.

// ── Generic API shapes ─────────────────────────

export interface HealthResponse {
  status: string;
  version: string;
  edgeId: string;
  checks?: HealthChecks;
}

export interface PageInfo {
  nextCursor?: string;
  hasMore: boolean;
}

export interface ListResponse<T> {
  items: T[];
  page: PageInfo;
}

// ── IM / Project ───────────────────────────────

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ProjectMemory {
  projectId: string;
  files: number;
  sizeBytes: number;
}

export interface Conversation {
  id: string;
  title?: string;
  createdAt: string;
}

export interface Thread {
  id: string;
  projectId: string;
  conversationId?: string;
  title?: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt?: string;
}

export type ThreadItemKind = 'message' | 'code' | 'file' | 'diff' | 'approval';

export interface ThreadItem {
  id: string;
  threadId: string;
  kind: ThreadItemKind;
  role: 'user' | 'agent';
  content: string;
  createdAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  role: 'user' | 'agent';
  content: string;
  createdAt: string;
}

// ── Execution / Runner ─────────────────────────

export interface Runner {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'draining';
  capabilities?: string;
}

export type RunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_approval'
  | 'finished'
  | 'failed'
  | 'cancelled';

export interface Run {
  runId: string;
  projectId: string;
  threadId: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface StartRunRequest {
  projectId?: string;
  threadId?: string;
}

export interface RunLogs {
  runId: string;
  stdout: string;
  stderr: string;
}

export interface RunDiff {
  runId: string;
  files: DiffFile[];
}

export interface DiffFile {
  path: string;
  diff: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface Approval {
  id: string;
  runId: string;
  threadId: string;
  kind: 'file_write' | 'command' | 'publish';
  summary: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt?: string;
}

export interface Artifact {
  id: string;
  runId: string;
  threadId: string;
  kind: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Preview {
  id: string;
  runId: string;
  threadId: string;
  url?: string;
  status: 'starting' | 'ready' | 'stopped';
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  runId?: string;
  createdAt: string;
}

export interface WorkspaceFile {
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}
