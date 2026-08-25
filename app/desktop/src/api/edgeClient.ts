// Edge REST API client — typed wrappers around fetch.
// Uses @agenthub/shared for all response types and error handling.
// P0-1: Zod schema validation with safeParse on all responses.

import { getEdgeBaseUrl } from '@/config';
import type {
  HealthResponse,
  Runner,
  AgentInfo,
  ListResponse,
  RunInfo,
  RunDiff,
  ThreadInfo,
  ThreadItemInfo,
  ThreadPinInfo,
  StartRunRequest,
  Artifact,
  Preview,
  UserProfileInfo,
} from '@shared/types';
import type { CheckpointFileContent, CheckpointSummary } from '@shared/platform';
import { parseError } from '@shared/errors';
import type { AppError } from '@shared/errors';
import { edgeAuthHeaders, getEdgeAuthToken, refreshEdgeAuthToken } from './edgeAuth';
import {
  HealthResponseSchema,
  RunnerSchema,
  AgentInfoSchema,
  RunInfoSchema,
  RunDiffSchema,
  ApplyRunDiffResponseSchema,
  ApplyAllRunDiffsResponseSchema,
  RunCheckpointSchema,
  RunCheckpointFileSchema,
  ArtifactSchema,
  PreviewSchema,
  ThreadInfoSchema,
  ModelCatalogResponseSchema,
  safeParse,
  listResponseSchema,
  ThreadItemInfoSchema,
  ThreadPinInfoSchema,
  EdgeAgentProfileSchema,
} from './schemas';

export type {
  HealthResponse,
  Runner,
  AgentInfo,
  ListResponse,
  RunInfo,
  RunDiff,
  ThreadInfo,
  ThreadItemInfo,
  ThreadPinInfo,
  StartRunRequest,
  Artifact,
  Preview,
};

export interface ModelCatalogItem {
  id: string;
  value: string;
  label: string;
  provider?: string;
  runtimeId?: string;
  resolvedModel?: string;
  sourceId: string;
  sourceLabel: string;
  status: string;
  description?: string;
  tags?: string[];
  reasoningEfforts?: string[];
  default?: boolean;
}

export interface ModelCatalogSource {
  id: string;
  label: string;
  status: string;
  detail?: string;
}

export interface ModelCatalogResponse {
  items: ModelCatalogItem[];
  sources: ModelCatalogSource[];
}

const BASE = getEdgeBaseUrl().replace(/\/+$/, '');

function edgeRequestInit(init: RequestInit = {}, baseHeaders?: HeadersInit): RequestInit {
  const headers = edgeAuthHeaders(baseHeaders);
  return headers ? { ...init, headers } : init;
}

/**
 * Check if Edge is running in dev mode (AGENTHUB_DEV=1).
 * When the Tauri desktop app starts Edge, it always passes AGENTHUB_DEV=1,
 * which disables auth on the server side. In that case EDGE_AUTH_TOKEN will
 * be empty and we should not send auth headers at all.
 */
function isEdgeDevMode(): boolean {
  // If no auth token is configured, Edge was started in dev mode by Tauri
  // and does not require authentication. Sending an empty Bearer token
  // would cause the server to attempt auth validation and fail.
  return !getEdgeAuthToken();
}

function edgeDevRequestInit(init: RequestInit = {}, baseHeaders?: HeadersInit): RequestInit {
  if (isEdgeDevMode()) {
    // Dev mode: no auth needed. Merge base headers only.
    if (!baseHeaders) return init;
    return { ...init, headers: baseHeaders };
  }
  return edgeRequestInit(init, baseHeaders);
}

/**
 * Auth-aware fetch wrapper. On 401, refreshes the Edge auth token from the
 * Vite dev middleware and retries the request once. This handles the case
 * where Desktop restarts Edge (generating a new token) while the Vite dev
 * server is still running with a stale build-time token.
 */
async function edgeFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 401) return res;
  // Attempt token refresh and retry once.
  const newToken = await refreshEdgeAuthToken();
  if (!newToken) return res; // No token available — return the 401 as-is.
  // Rebuild the request with the fresh token.
  const retryInit = init ? { ...init } : {};
  const retryHeaders = edgeAuthHeaders(
    init?.headers instanceof Headers
      ? Object.fromEntries((init.headers as Headers).entries())
      : (init?.headers as Record<string, string> | undefined),
  );
  if (retryHeaders) retryInit.headers = retryHeaders;
  return fetch(url, retryInit);
}

/**
 * Extracts the .data field from a unified {@code {"code":"OK","data":...}} envelope.
 * Returns the raw input unchanged when no envelope is present, preserving backward
 * compatibility with Edge Servers that have not yet adopted the envelope format.
 */
function unwrapEdgeResponse(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === 'object' &&
    'code' in raw &&
    'data' in raw &&
    (raw as Record<string, unknown>).code === 'OK'
  ) {
    return (raw as Record<string, unknown>).data;
  }
  return raw;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/v1/health`);
  if (!res.ok) throw await parseError(res);
  return safeParse<HealthResponse>(HealthResponseSchema, unwrapEdgeResponse(await res.json()), 'health');
}

export async function fetchRunners(): Promise<ListResponse<Runner>> {
  const res = await edgeFetch(`${BASE}/v1/runners`, edgeDevRequestInit());
  if (!res.ok) throw await parseError(res);
  return safeParse<ListResponse<Runner>>(listResponseSchema(RunnerSchema), unwrapEdgeResponse(await res.json()), 'runners');
}

export async function fetchAgents(): Promise<ListResponse<AgentInfo>> {
  const res = await edgeFetch(`${BASE}/v1/agents`, edgeDevRequestInit());
  if (!res.ok) throw await parseError(res);
  const raw = unwrapEdgeResponse(await res.json());
  const normalized = normalizeAgentList(raw);
  return safeParse<ListResponse<AgentInfo>>(listResponseSchema(AgentInfoSchema), normalized, 'agents');
}

export async function fetchModelCatalog(): Promise<ModelCatalogResponse> {
  const res = await edgeFetch(`${BASE}/v1/model-catalog`, edgeDevRequestInit());
  if (!res.ok) throw await parseError(res);
  return safeParse<ModelCatalogResponse>(ModelCatalogResponseSchema, unwrapEdgeResponse(await res.json()), 'modelCatalog');
}

function normalizeAgentList(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !('items' in raw) || !Array.isArray((raw as { items?: unknown }).items)) {
    return raw;
  }

  return {
    ...(raw as Record<string, unknown>),
    items: (raw as { items: Array<Record<string, unknown>> }).items.map((agent) => ({
      ...agent,
      capabilities: normalizeAgentCapabilities(agent.capabilities),
    })),
  };
}

function normalizeAgentCapabilities(raw: unknown): AgentInfo['capabilities'] {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const read = (camel: string, pascal: string) => Boolean(source[camel] ?? source[pascal]);
  return {
    streaming: read('streaming', 'Streaming'),
    toolCalls: read('toolCalls', 'ToolCalls'),
    fileChanges: read('fileChanges', 'FileChanges'),
    thinkingVisible: read('thinkingVisible', 'ThinkingVisible'),
    multiTurn: read('multiTurn', 'MultiTurn'),
    mcpIntegration: read('mcpIntegration', 'MCPIntegration'),
    permissionHooks: read('permissionHooks', 'PermissionHooks'),
    subAgentSpawn: read('subAgentSpawn', 'SubAgentSpawn'),
  };
}

export async function fetchThreads(projectId?: string): Promise<ListResponse<ThreadInfo>> {
  const params = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await edgeFetch(`${BASE}/v1/threads${params}`, edgeDevRequestInit());
  if (!res.ok) throw await parseError(res);
  return safeParse<ListResponse<ThreadInfo>>(listResponseSchema(ThreadInfoSchema), unwrapEdgeResponse(await res.json()), 'threads');
}

export interface CreateThreadRequest {
  projectId?: string;
  threadId?: string;
  title?: string;
}

export async function createThread(input?: string | CreateThreadRequest, threadId?: string): Promise<ThreadInfo> {
  const body: CreateThreadRequest = typeof input === 'object'
    ? input
    : { title: input ?? '', threadId: threadId ?? '' };
  const res = await edgeFetch(`${BASE}/v1/threads`, {
    method: 'POST',
    ...edgeDevRequestInit({}, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      projectId: body.projectId,
      threadId: body.threadId ?? '',
      title: body.title ?? '',
    }),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<ThreadInfo>(ThreadInfoSchema, unwrapEdgeResponse(await res.json()), 'createThread');
}

export async function fetchThreadItems(threadId: string): Promise<ListResponse<ThreadItemInfo>> {
  const res = await edgeFetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}/items`, {
    ...edgeDevRequestInit(),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<ListResponse<ThreadItemInfo>>(listResponseSchema(ThreadItemInfoSchema), unwrapEdgeResponse(await res.json()), 'threadItems');
}

export async function fetchThreadPins(threadId: string): Promise<ListResponse<ThreadPinInfo>> {
  const res = await edgeFetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}/pins`, {
    ...edgeDevRequestInit(),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<ListResponse<ThreadPinInfo>>(listResponseSchema(ThreadPinInfoSchema), unwrapEdgeResponse(await res.json()), 'threadPins');
}

export async function pinThreadItem(threadId: string, itemId: string, pinnedBy?: string): Promise<ThreadPinInfo> {
  const res = await edgeFetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}/pins`, {
    method: 'POST',
    ...edgeDevRequestInit({}, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ itemId, pinnedBy }),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<ThreadPinInfo>(ThreadPinInfoSchema, unwrapEdgeResponse(await res.json()), 'pinThreadItem');
}

export async function deleteThreadPin(threadId: string, itemId: string): Promise<void> {
  const res = await edgeFetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}/pins?itemId=${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    ...edgeDevRequestInit(),
  });
  if (!res.ok) throw await parseError(res);
}

export async function fetchRuns(projectId?: string, threadId?: string): Promise<ListResponse<RunInfo>> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (threadId) params.set('threadId', threadId);
  const qs = params.toString();
  const res = await edgeFetch(`${BASE}/v1/runs${qs ? `?${qs}` : ''}`, edgeDevRequestInit());
  if (!res.ok) throw await parseError(res);
  return safeParse<ListResponse<RunInfo>>(listResponseSchema(RunInfoSchema), unwrapEdgeResponse(await res.json()), 'runs');
}

export async function startRun(req?: StartRunRequest): Promise<RunInfo> {
  const init: RequestInit = {
    method: 'POST',
  };
  if (req) init.body = JSON.stringify(req);
  const res = await edgeFetch(`${BASE}/v1/runs`, edgeDevRequestInit(init, req ? { 'Content-Type': 'application/json' } : undefined));
  if (!res.ok) throw await parseError(res);
  return safeParse<RunInfo>(RunInfoSchema, unwrapEdgeResponse(await res.json()), 'startRun');
}

export async function cancelRun(runId: string): Promise<RunInfo> {
  const res = await edgeFetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}:cancel`, {
    method: 'POST',
    ...edgeDevRequestInit(),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<RunInfo>(RunInfoSchema, unwrapEdgeResponse(await res.json()), 'cancelRun');
}

export async function fetchRunDiff(runId: string): Promise<RunDiff> {
  const res = await edgeFetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}/diff`, {
    ...edgeDevRequestInit(),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<RunDiff>(RunDiffSchema, unwrapEdgeResponse(await res.json()), 'runDiff');
}

export interface ApplyRunDiffRequest {
  filePath: string;
  hunkIndex: number;
  accepted: boolean;
  workDir: string;
}

export interface ApplyRunDiffResponse {
  runId: string;
  filePath: string;
  hunkIndex: number;
  accepted: boolean;
  applied: boolean;
}

export interface ApplyAllRunDiffsRequest {
  decisions: Array<Pick<ApplyRunDiffRequest, 'filePath' | 'hunkIndex' | 'accepted'>>;
  workDir: string;
}

export interface ApplyAllRunDiffsResponse {
  runId: string;
  applied: number;
}

/** Write one hunk accept/reject decision back into the run workdir. */
export async function applyRunDiff(runId: string, request: ApplyRunDiffRequest): Promise<ApplyRunDiffResponse> {
  const res = await edgeFetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}/apply`, {
    method: 'POST',
    ...edgeDevRequestInit({}, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      file_path: request.filePath,
      hunk_index: request.hunkIndex,
      accepted: request.accepted,
      workDir: request.workDir,
    }),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<ApplyRunDiffResponse>(ApplyRunDiffResponseSchema, unwrapEdgeResponse(await res.json()), 'applyRunDiff');
}

/** Batch variant of applyRunDiff for accept-all / reject-all decisions. */
export async function applyAllRunDiffs(runId: string, request: ApplyAllRunDiffsRequest): Promise<ApplyAllRunDiffsResponse> {
  const res = await edgeFetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}/apply-all`, {
    method: 'POST',
    ...edgeDevRequestInit({}, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      decisions: request.decisions.map((decision) => ({
        file_path: decision.filePath,
        hunk_index: decision.hunkIndex,
        accepted: decision.accepted,
      })),
      workDir: request.workDir,
    }),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<ApplyAllRunDiffsResponse>(ApplyAllRunDiffsResponseSchema, unwrapEdgeResponse(await res.json()), 'applyAllRunDiffs');
}

// ── #1968 pre-run checkpoint (read-only evidence) ─────────────────────
// 404 resolves to `undefined` — honest absence (run has no checkpoint or
// the path is not in the checkpoint), not an error.

/** Fetch pre-run checkpoint metadata + file inventory. */
export async function fetchRunCheckpoint(runId: string): Promise<CheckpointSummary | undefined> {
  const res = await edgeFetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}/checkpoint`, {
    ...edgeDevRequestInit(),
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw await parseError(res);
  return safeParse<CheckpointSummary>(RunCheckpointSchema, unwrapEdgeResponse(await res.json()), 'runCheckpoint');
}

/** Fetch the pre-run content of one checkpoint file (exact inventory path). */
export async function fetchRunCheckpointFile(runId: string, path: string): Promise<CheckpointFileContent | undefined> {
  const res = await edgeFetch(
    `${BASE}/v1/runs/${encodeURIComponent(runId)}/checkpoint/file?path=${encodeURIComponent(path)}`,
    { ...edgeDevRequestInit() },
  );
  if (res.status === 404) return undefined;
  if (!res.ok) throw await parseError(res);
  return safeParse<CheckpointFileContent>(RunCheckpointFileSchema, unwrapEdgeResponse(await res.json()), 'runCheckpointFile');
}

export async function fetchArtifacts(): Promise<ListResponse<Artifact>> {
  const res = await edgeFetch(`${BASE}/v1/artifacts`, edgeDevRequestInit());
  if (!res.ok) throw await parseError(res);
  return safeParse<ListResponse<Artifact>>(listResponseSchema(ArtifactSchema), unwrapEdgeResponse(await res.json()), 'artifacts');
}

export async function fetchPreviews(): Promise<ListResponse<Preview>> {
  const res = await edgeFetch(`${BASE}/v1/previews`, edgeDevRequestInit());
  if (!res.ok) throw await parseError(res);
  return safeParse<ListResponse<Preview>>(listResponseSchema(PreviewSchema), unwrapEdgeResponse(await res.json()), 'previews');
}

export async function renameThread(threadId: string, title: string): Promise<ThreadInfo> {
  const res = await edgeFetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    ...edgeDevRequestInit({}, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<ThreadInfo>(ThreadInfoSchema, unwrapEdgeResponse(await res.json()), 'renameThread');
}

export async function updateThreadStatus(threadId: string, status: 'active' | 'archived'): Promise<ThreadInfo> {
  const res = await edgeFetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    ...edgeDevRequestInit({}, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<ThreadInfo>(ThreadInfoSchema, unwrapEdgeResponse(await res.json()), 'updateThreadStatus');
}

export async function archiveThread(threadId: string): Promise<ThreadInfo> {
  const res = await edgeFetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}:archive`, {
    method: 'POST',
    ...edgeDevRequestInit(),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<ThreadInfo>(ThreadInfoSchema, unwrapEdgeResponse(await res.json()), 'archiveThread');
}

export async function deleteThread(threadId: string): Promise<'deleted' | 'archived'> {
  const res = await edgeFetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}`, {
    method: 'DELETE',
    ...edgeDevRequestInit(),
  });
  if (res.ok) return 'deleted';

  const error = await parseError(res);
  if (isMethodNotAllowed(error)) {
    await archiveThread(threadId);
    return 'archived';
  }
  throw error;
}

function isMethodNotAllowed(error: AppError): boolean {
  return error.status === 405 || error.code === 'method_not_allowed';
}

// ── Permission gating ────────────────────────

export interface PermissionDecideRequest {
  runId: string;
  requestId: string;
  decision: 'allow' | 'deny';
  reason?: string;
}

export async function decidePermission(req: PermissionDecideRequest): Promise<void> {
  const res = await edgeFetch(`${BASE}/v1/permissions/decide`, {
    method: 'POST',
    ...edgeDevRequestInit({}, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(req),
  });
  if (!res.ok) throw await parseError(res);
}

// ── Agent Profile CRUD ────────────────────────

export interface EdgeAgentProfile {
  id: string;
  name: string;
  description?: string;
  adapterId: string;
  model?: string;
  provider?: string;
  reasoningEffort?: string;
  thinkingMode?: string;
  maxThinkingTokens?: number;
  permissionMode?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  mcpConfig?: string;
  skills?: string[];
  avatarRef?: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchAgentProfiles(adapterId?: string): Promise<ListResponse<EdgeAgentProfile>> {
  const url = adapterId
    ? `${BASE}/v1/agent-profiles?adapterId=${encodeURIComponent(adapterId)}`
    : `${BASE}/v1/agent-profiles`;
  const res = await edgeFetch(url, edgeDevRequestInit());
  if (!res.ok) throw await parseError(res);
  return safeParse<ListResponse<EdgeAgentProfile>>(
    listResponseSchema(EdgeAgentProfileSchema),
    unwrapEdgeResponse(await res.json()),
    'agentProfiles',
  );
}

export async function createAgentProfile(data: Record<string, unknown>): Promise<EdgeAgentProfile> {
  const res = await edgeFetch(`${BASE}/v1/agent-profiles`, {
    method: 'POST',
    ...edgeDevRequestInit({}, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<EdgeAgentProfile>(EdgeAgentProfileSchema, unwrapEdgeResponse(await res.json()), 'createAgentProfile');
}

export async function updateAgentProfile(id: string, patch: Partial<EdgeAgentProfile>): Promise<EdgeAgentProfile> {
  const res = await edgeFetch(`${BASE}/v1/agent-profiles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    ...edgeDevRequestInit({}, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse<EdgeAgentProfile>(EdgeAgentProfileSchema, unwrapEdgeResponse(await res.json()), 'updateAgentProfile');
}

export async function deleteAgentProfile(id: string): Promise<void> {
  const res = await edgeFetch(`${BASE}/v1/agent-profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    ...edgeDevRequestInit(),
  });
  if (!res.ok) throw await parseError(res);
}

// ── cc-switch integration ──────────────────────────────────────────────

export interface CCSwitchStatus {
  installed: boolean;
  dbPath?: string;
  configDir?: string;
  routingActive: boolean;
  proxyPort?: number;
  activeAppTypes?: string[];
}

export interface CCSwitchProviderModelMapping {
  providerId: string;
  providerName: string;
  appType: string;
  providerType?: string;
  baseUrl?: string;
  apiKeySet: boolean;
  isCurrent: boolean;
  inFailover: boolean;
  isActive: boolean;
  costMultiplier?: string;
  modelAliases?: Record<string, string>;
}

export async function fetchCCSwitchStatus(): Promise<CCSwitchStatus> {
  try {
    const res = await edgeFetch(`${BASE}/v1/ccswitch/status`, edgeDevRequestInit());
    if (!res.ok) throw await parseError(res);
    return unwrapEdgeResponse(await res.json()) as CCSwitchStatus;
  } catch {
    return { installed: false, routingActive: false };
  }
}

export async function fetchCCSwitchProviders(appType?: string): Promise<CCSwitchProviderModelMapping[]> {
  try {
    const params = appType ? `?appType=${encodeURIComponent(appType)}` : '';
    const res = await edgeFetch(`${BASE}/v1/ccswitch/providers${params}`, edgeDevRequestInit());
    if (!res.ok) throw await parseError(res);
    const data = unwrapEdgeResponse(await res.json());
    // Response may be { items: [...] } or raw array
    if (data && typeof data === 'object' && 'items' in data) {
      return (data as { items: CCSwitchProviderModelMapping[] }).items;
    }
    return Array.isArray(data) ? data as CCSwitchProviderModelMapping[] : [];
  } catch {
    return [];
  }
}

// ── Settings ──────────────────────────────────────────────────────────

export async function fetchSettings(): Promise<Record<string, string>> {
  try {
    const res = await edgeFetch(`${BASE}/v1/settings`, edgeDevRequestInit());
    if (!res.ok) throw await parseError(res);
    return unwrapEdgeResponse(await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function patchSettings(values: Record<string, string>): Promise<Record<string, string>> {
  const res = await edgeFetch(`${BASE}/v1/settings`, {
    method: 'PATCH',
    ...edgeDevRequestInit({}, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(values),
  });
  if (!res.ok) throw await parseError(res);
  return unwrapEdgeResponse(await res.json()) as Record<string, string>;
}

// ── User profiles ─────────────────────────────────

export async function fetchCurrentUser(): Promise<UserProfileInfo> {
  const res = await edgeFetch(`${BASE}/v1/users/current`, edgeDevRequestInit());
  if (!res.ok) throw await parseError(res);
  const data = unwrapEdgeResponse(await res.json());
  const rawAvatarUrl = (data as Record<string, unknown>).avatarUrl as string | undefined;
  const rawStatus = (data as Record<string, unknown>).status as string | undefined;
  return {
    userId: (data as Record<string, unknown>).userId as string ?? '',
    displayName: (data as Record<string, unknown>).displayName as string ?? '',
    ...(rawAvatarUrl ? { avatarUrl: rawAvatarUrl } : {}),
    ...(rawStatus ? { status: rawStatus } : {}),
    createdAt: (data as Record<string, unknown>).createdAt as string ?? '',
    updatedAt: (data as Record<string, unknown>).updatedAt as string ?? '',
  };
}
