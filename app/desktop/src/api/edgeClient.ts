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
  StartRunRequest,
  Artifact,
  Preview,
} from '@shared/types';
import { parseError } from '@shared/errors';
import type { AppError } from '@shared/errors';
import { edgeAuthHeaders } from './edgeAuth';
import {
  HealthResponseSchema,
  RunnerSchema,
  AgentInfoSchema,
  RunInfoSchema,
  RunDiffSchema,
  ArtifactSchema,
  PreviewSchema,
  ThreadInfoSchema,
  ModelCatalogResponseSchema,
  safeParse,
  listResponseSchema,
  ThreadItemInfoSchema,
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

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/v1/health`);
  if (!res.ok) throw await parseError(res);
  return safeParse(HealthResponseSchema, await res.json(), 'health');
}

export async function fetchRunners(): Promise<ListResponse<Runner>> {
  const res = await fetch(`${BASE}/v1/runners`, { headers: edgeAuthHeaders() });
  if (!res.ok) throw await parseError(res);
  return safeParse(listResponseSchema(RunnerSchema), await res.json(), 'runners');
}

export async function fetchAgents(): Promise<ListResponse<AgentInfo>> {
  const res = await fetch(`${BASE}/v1/agents`, { headers: edgeAuthHeaders() });
  if (!res.ok) throw await parseError(res);
  const raw = await res.json();
  const normalized = normalizeAgentList(raw);
  return safeParse(listResponseSchema(AgentInfoSchema), normalized, 'agents');
}

export async function fetchModelCatalog(): Promise<ModelCatalogResponse> {
  const res = await fetch(`${BASE}/v1/model-catalog`, { headers: edgeAuthHeaders() });
  if (!res.ok) throw await parseError(res);
  return safeParse(ModelCatalogResponseSchema, await res.json(), 'modelCatalog');
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
  const res = await fetch(`${BASE}/v1/threads${params}`, { headers: edgeAuthHeaders() });
  if (!res.ok) throw await parseError(res);
  return safeParse(listResponseSchema(ThreadInfoSchema), await res.json(), 'threads');
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
  const res = await fetch(`${BASE}/v1/threads`, {
    method: 'POST',
    headers: edgeAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      projectId: body.projectId,
      threadId: body.threadId ?? '',
      title: body.title ?? '',
    }),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(ThreadInfoSchema, await res.json(), 'createThread');
}

export async function fetchThreadItems(threadId: string): Promise<ListResponse<ThreadItemInfo>> {
  const res = await fetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}/items`, {
    headers: edgeAuthHeaders(),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(listResponseSchema(ThreadItemInfoSchema), await res.json(), 'threadItems');
}

export async function fetchRuns(projectId?: string, threadId?: string): Promise<ListResponse<RunInfo>> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (threadId) params.set('threadId', threadId);
  const qs = params.toString();
  const res = await fetch(`${BASE}/v1/runs${qs ? `?${qs}` : ''}`, { headers: edgeAuthHeaders() });
  if (!res.ok) throw await parseError(res);
  return safeParse(listResponseSchema(RunInfoSchema), await res.json(), 'runs');
}

export async function startRun(req?: StartRunRequest): Promise<RunInfo> {
  const res = await fetch(`${BASE}/v1/runs`, {
    method: 'POST',
    headers: edgeAuthHeaders(req ? { 'Content-Type': 'application/json' } : undefined),
    body: req ? JSON.stringify(req) : undefined,
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(RunInfoSchema, await res.json(), 'startRun');
}

export async function cancelRun(runId: string): Promise<RunInfo> {
  const res = await fetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}:cancel`, {
    method: 'POST',
    headers: edgeAuthHeaders(),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(RunInfoSchema, await res.json(), 'cancelRun');
}

export async function fetchRunDiff(runId: string): Promise<RunDiff> {
  const res = await fetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}/diff`, {
    headers: edgeAuthHeaders(),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(RunDiffSchema, await res.json(), 'runDiff');
}

export async function fetchArtifacts(): Promise<ListResponse<Artifact>> {
  const res = await fetch(`${BASE}/v1/artifacts`, { headers: edgeAuthHeaders() });
  if (!res.ok) throw await parseError(res);
  return safeParse(listResponseSchema(ArtifactSchema), await res.json(), 'artifacts');
}

export async function fetchPreviews(): Promise<ListResponse<Preview>> {
  const res = await fetch(`${BASE}/v1/previews`, { headers: edgeAuthHeaders() });
  if (!res.ok) throw await parseError(res);
  return safeParse(listResponseSchema(PreviewSchema), await res.json(), 'previews');
}

export async function renameThread(threadId: string, title: string): Promise<ThreadInfo> {
  const res = await fetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    headers: edgeAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(ThreadInfoSchema, await res.json(), 'renameThread');
}

export async function updateThreadStatus(threadId: string, status: 'active' | 'archived'): Promise<ThreadInfo> {
  const res = await fetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    headers: edgeAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(ThreadInfoSchema, await res.json(), 'updateThreadStatus');
}

export async function archiveThread(threadId: string): Promise<ThreadInfo> {
  const res = await fetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}:archive`, {
    method: 'POST',
    headers: edgeAuthHeaders(),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(ThreadInfoSchema, await res.json(), 'archiveThread');
}

export async function deleteThread(threadId: string): Promise<'deleted' | 'archived'> {
  const res = await fetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}`, {
    method: 'DELETE',
    headers: edgeAuthHeaders(),
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
  const res = await fetch(`${BASE}/v1/permissions/decide`, {
    method: 'POST',
    headers: edgeAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(req),
  });
  if (!res.ok) throw await parseError(res);
}
