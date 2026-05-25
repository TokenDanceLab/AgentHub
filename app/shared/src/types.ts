// ── REST API types ──────────────────────────────

export interface HealthResponse {
  status: string;
  version: string;
  edgeId: string;
  checks?: HealthChecks;
}

export interface Runner {
  id: string;
  name: string;
  status: string;
  capabilities?: string;
}

export interface HealthCheck {
  status: string;
  detail?: string;
  [key: string]: unknown;
}

export interface RunnerHealthItem {
  id: string;
  name: string;
  status: string;
  capabilities?: string[];
}

export interface RunnerHealthCheck extends HealthCheck {
  total?: number;
  available?: number;
  unavailable?: number;
  statuses?: Record<string, number>;
  items?: RunnerHealthItem[];
}

export interface HealthChecks {
  store?: HealthCheck;
  adapters?: HealthCheck;
  executor?: HealthCheck;
  runners?: RunnerHealthCheck;
  [name: string]: HealthCheck | RunnerHealthCheck | undefined;
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
  mcpIntegration: boolean;
  permissionHooks: boolean;
  subAgentSpawn: boolean;
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
  provider?: string;
  modelAlias?: string;
  modelMappingEnabled?: boolean;
  providerFallbackEnabled?: boolean;
  reasoningEffort?: string;
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
