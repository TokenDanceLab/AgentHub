import { mockRunners, mockRuns, mockThreads } from '@shared/mock';
import type {
  AgentInfo,
  HealthResponse,
  ListResponse,
  RunInfo,
  Runner,
  StartRunRequest,
  ThreadInfo,
} from '@shared/types';

function page<T>(items: T[]): ListResponse<T> {
  return { items, page: { hasMore: false } };
}

function toThreadInfo(thread: { id: string; projectId: string; title?: string; status: string; createdAt: string; updatedAt?: string }): ThreadInfo {
  return {
    threadId: thread.id,
    projectId: thread.projectId,
    title: thread.title || 'Untitled thread',
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt || thread.createdAt,
  };
}

function toRunInfo(run: { runId: string; projectId: string; threadId: string; status: string; createdAt?: string; startedAt?: string; finishedAt?: string }): RunInfo {
  return {
    runId: run.runId,
    projectId: run.projectId,
    threadId: run.threadId,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function toAgentInfo(runner: Runner): AgentInfo {
  return {
    id: runner.id,
    name: runner.name,
    description: `Hub-only web preview for ${runner.name}`,
    status: runner.status === 'online' ? 'available' : 'unavailable',
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
      executor: { status: 'stubbed', detail: 'Web connects through Hub; local Edge is not used.' },
      runners: {
        status: 'stubbed',
        total: mockRunners.length,
        available: mockRunners.filter((runner) => runner.status === 'online').length,
        items: mockRunners.map((runner) => ({
          id: runner.id,
          name: runner.name,
          status: runner.status,
          capabilities: runner.capabilities?.split(',') ?? [],
        })),
      },
    },
  };
}

export async function fetchRunners(): Promise<ListResponse<Runner>> {
  return page(mockRunners);
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
