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
  projectId: string;
  threadId: string;
  status: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

// ── Agent types ─────────────────────────────────

export interface AgentCapabilities {
  streaming: boolean;
  toolCalls: boolean;
  fileChanges: boolean;
  thinkingVisible: boolean;
  multiTurn: boolean;
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  version?: string;
  status: 'available' | 'unavailable' | 'configuring';
  capabilities: AgentCapabilities;
}

// ── Request types ───────────────────────────────

export interface StartRunRequest {
  projectId?: string;
  threadId?: string;
  prompt?: string;
  agentId?: string;
  model?: string;
}

// ── Thread types ────────────────────────────────

export interface ThreadInfo {
  threadId: string;
  projectId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ── Message / Item types ────────────────────────

export interface ItemInfo {
  itemId: string;
  projectId: string;
  threadId: string;
  runId?: string;
  type: string;
  role?: string;
  status: string;
  content?: string;
  createdAt: string;
  updatedAt: string;
}
