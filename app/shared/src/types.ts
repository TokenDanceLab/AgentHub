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

export interface HealthCheck {
  status: string;
  message?: string;
}

export interface RunnerHealthItem {
  id: string;
  name: string;
  status: string;
  capabilities?: string[];
}

export interface RunnerHealthCheck {
  status: string;
  message?: string;
  runnerIds?: string[];
  items?: RunnerHealthItem[];
  available?: number;
  total?: number;
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

// ── IM / Project ───────────────────────────────

export interface Project {
  id: string;
  name: string;
  description?: string | undefined;
  createdAt: string;
  updatedAt?: string | undefined;
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
  conversationId?: string | undefined;
  title?: string | undefined;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt?: string | undefined;
}

export interface ThreadInfo {
  threadId: string;
  projectId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
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

export interface ThreadPinInfo {
  threadId: string;
  itemId: string;
  pinnedBy?: string;
  pinnedAt: string;
  createdAt: string;
  updatedAt: string;
  item?: ThreadItemInfo;
}

// ── Execution / Runner ─────────────────────────

export interface Runner {
  id: string;
  name: string;
  status: string;
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
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
}

export interface StartRunRequest {
  projectId?: string;
  threadId?: string;
  prompt?: string;
  agentId?: string;
  model?: string;
  modelAlias?: string;
  reasoningEffort?: string;
  modelMappingEnabled?: boolean;
  providerFallbackEnabled?: boolean;
}
export interface RunInfo {
  runId: string;
  projectId: string;
  threadId: string;
  status: string;
  createdAt?: string | undefined;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
}

// ── Agent types ─────────────────────────────────

// Compatibility aliases for Desktop code that still consumes the original
// Edge REST shape while the domain model above is being consolidated.
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
  profileId?: string;
  runtimeId?: string;
  model?: string;
  provider?: string;
  reasoningEffort?: string;
  approvalPolicy?: string;
  permissionMode?: string;
  skills?: string[];
  toolAllowlist?: string[];
  targetPreferences?: Record<string, unknown>;
  status: 'available' | 'unavailable' | 'configuring';
  capabilities: AgentCapabilities;
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

export interface ThreadInfo {
  threadId: string;
  projectId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadItemInfo {
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

export interface StartRunRequest {
  projectId?: string;
  threadId?: string;
  prompt?: string;
  agentId?: string;
  model?: string;
  modelAlias?: string;
  modelMappingEnabled?: boolean;
  providerFallbackEnabled?: boolean;
  sessionId?: string;
  continue?: boolean;
  fork?: boolean;
  reasoningEffort?: string;
  thinkingMode?: string;
  maxThinkingTokens?: number;
  permissionMode?: string;
  workDir?: string;
  includePartial?: boolean;
  structuredOutputSchema?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  configOverrides?: Record<string, string>;
  agentDefinitions?: Record<string, AgentDefinition>;
  mcpConfig?: string;
  ephemeral?: boolean;
  hubTaskId?: string;
}

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
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
  decidedAt?: string | undefined;
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
  url?: string | undefined;
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
