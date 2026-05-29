import { mockRunners, mockRuns, mockThreads } from '@shared/mock';
import type {
  AgentInfo,
  HealthResponse,
  ListResponse,
  Run,
  RunInfo,
  Runner,
  StartRunRequest,
  Thread,
  ThreadInfo,
} from '@shared/types';

function page<T>(items: T[]): ListResponse<T> {
  return { items, page: { hasMore: false } };
}

function toThreadInfo(thread: Thread): ThreadInfo {
  return {
    threadId: thread.id,
    projectId: thread.projectId,
    title: thread.title || 'Untitled thread',
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt || thread.createdAt,
  };
}

function toRunInfo(run: Run): RunInfo {
  return {
    runId: run.runId,
    projectId: run.projectId,
    threadId: run.threadId,
    status: run.status,
    createdAt: run.createdAt,
    ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
    ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
  };
}

function toAgentInfo(runner: Runner): AgentInfo {
  return {
    id: runner.id,
    name: runner.name,
    description: `Preview only; real availability comes from Hub profiles and a signed-in Desktop route.`,
    status: 'configuring',
    capabilities: {
      streaming: true,
      toolCalls: true,
      fileChanges: true,
      thinkingVisible: true,
      multiTurn: true,
      mcpIntegration: true,
      permissionHooks: true,
      subAgentSpawn: false,
    },
  };
}

export async function fetchHealth(): Promise<HealthResponse> {
  return {
    status: 'hub-only',
    version: 'web-preview',
    edgeId: 'web-hub-only',
    checks: {
      executor: { status: 'stubbed', detail: 'Web connects through Hub; browser code does not probe Local Edge.' },
      runners: {
        status: 'stubbed',
        detail: 'Runtime readiness is reported by Desktop/Local Edge during dispatch, not by this web preview.',
        total: 0,
        available: 0,
        items: [],
      },
    },
  };
}

export async function fetchRunners(): Promise<ListResponse<Runner>> {
  return page([]);
}

export async function fetchAgents(): Promise<ListResponse<AgentInfo>> {
  return page(mockRunners.map(toAgentInfo));
}

export async function fetchThreads(projectId?: string): Promise<ListResponse<ThreadInfo>> {
  const items = mockThreads
    .filter((thread) => !projectId || thread.projectId === projectId)
    .map(toThreadInfo);
  return page(items);
}

export async function createThread(title?: string, threadId?: string): Promise<ThreadInfo> {
  const now = new Date().toISOString();
  return {
    threadId: threadId || `web-thread-${Date.now()}`,
    projectId: 'web-preview',
    title: title || 'New thread',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export async function fetchThreadItems(_threadId: string): Promise<ListResponse<{ id: string; role: string; content: string; timestamp: string }>> {
  return page([]);
}

export async function fetchRuns(projectId?: string, threadId?: string): Promise<ListResponse<RunInfo>> {
  const items = mockRuns
    .filter((run) => (!projectId || run.projectId === projectId) && (!threadId || run.threadId === threadId))
    .map(toRunInfo);
  return page(items);
}

export async function startRun(req?: StartRunRequest): Promise<RunInfo> {
  return {
    runId: `web-run-${Date.now()}`,
    projectId: req?.projectId || 'web-preview',
    threadId: req?.threadId || 'web-thread',
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
}

export async function cancelRun(runId: string): Promise<RunInfo> {
  return {
    runId,
    projectId: 'web-preview',
    threadId: 'web-thread',
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
  };
}

export async function renameThread(threadId: string, title: string): Promise<ThreadInfo> {
  const now = new Date().toISOString();
  return {
    threadId,
    projectId: 'web-preview',
    title,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export async function deleteThread(_threadId: string): Promise<void> {
  return undefined;
}
