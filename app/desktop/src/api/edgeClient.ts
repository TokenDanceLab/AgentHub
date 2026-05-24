// Edge REST API client — typed wrappers around fetch.
// Uses @agenthub/shared for all response types and error handling.
// P0-1: Zod schema validation with safeParse on all responses.

import { EDGE_URL } from '@/config';
import type {
  HealthResponse,
  Runner,
  AgentInfo,
  ListResponse,
  RunInfo,
  ThreadInfo,
  StartRunRequest,
} from '@shared/types';
import { parseError } from '@shared/errors';
import {
  HealthResponseSchema,
  RunnerSchema,
  AgentInfoSchema,
  RunInfoSchema,
  ThreadInfoSchema,
  safeParse,
  listResponseSchema,
} from './schemas';

export type {
  HealthResponse,
  Runner,
  AgentInfo,
  ListResponse,
  RunInfo,
  ThreadInfo,
  StartRunRequest,
};

const BASE = EDGE_URL.replace(/\/+$/, '');

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/v1/health`);
  if (!res.ok) throw await parseError(res);
  return safeParse(HealthResponseSchema, await res.json(), 'health');
}

export async function fetchRunners(): Promise<ListResponse<Runner>> {
  const res = await fetch(`${BASE}/v1/runners`);
  if (!res.ok) throw await parseError(res);
  return safeParse(listResponseSchema(RunnerSchema), await res.json(), 'runners');
}

export async function fetchAgents(): Promise<ListResponse<AgentInfo>> {
  const res = await fetch(`${BASE}/v1/agents`);
  if (!res.ok) throw await parseError(res);
  const raw = await res.json();
  const normalized = normalizeAgentList(raw);
  return safeParse(listResponseSchema(AgentInfoSchema), normalized, 'agents');
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
  const res = await fetch(`${BASE}/v1/threads${params}`);
  if (!res.ok) throw await parseError(res);
  return safeParse(listResponseSchema(ThreadInfoSchema), await res.json(), 'threads');
}

export async function fetchRuns(projectId?: string, threadId?: string): Promise<ListResponse<RunInfo>> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (threadId) params.set('threadId', threadId);
  const qs = params.toString();
  const res = await fetch(`${BASE}/v1/runs${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw await parseError(res);
  return safeParse(listResponseSchema(RunInfoSchema), await res.json(), 'runs');
}

export async function startRun(req?: StartRunRequest): Promise<RunInfo> {
  const res = await fetch(`${BASE}/v1/runs`, {
    method: 'POST',
    headers: req ? { 'Content-Type': 'application/json' } : undefined,
    body: req ? JSON.stringify(req) : undefined,
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(RunInfoSchema, await res.json(), 'startRun');
}

export async function cancelRun(runId: string): Promise<RunInfo> {
  const res = await fetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}:cancel`, {
    method: 'POST',
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(RunInfoSchema, await res.json(), 'cancelRun');
}

export async function renameThread(threadId: string, title: string): Promise<ThreadInfo> {
  const res = await fetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw await parseError(res);
  return safeParse(ThreadInfoSchema, await res.json(), 'renameThread');
}

export async function deleteThread(threadId: string): Promise<void> {
  const res = await fetch(`${BASE}/v1/threads/${encodeURIComponent(threadId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw await parseError(res);
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw await parseError(res);
}
