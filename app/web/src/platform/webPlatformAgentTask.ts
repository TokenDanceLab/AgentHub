import type { QueryClient } from '@tanstack/react-query';
import { webQueryKeys } from '@shared/stores/queryKeys';

export interface WebActiveAgentTask {
  taskId: string;
  sessionId?: string;
  agentInstanceId?: string;
  triggerMessageId?: string;
  targetId?: string;
  edgeRunId?: string;
  edgeDeviceId?: string;
  status: string;
}

export function webActiveAgentTaskQueryKey(sessionId: string): readonly unknown[] {
  return webQueryKeys.agentTask.active(sessionId);
}

export function webAgentTaskIndexQueryKey(taskId: string): readonly unknown[] {
  return webQueryKeys.agentTask.index(taskId);
}

export function recordWebAgentTaskIndex(
  queryClient: QueryClient | undefined,
  task: WebActiveAgentTask,
): void {
  queryClient?.setQueryData(webAgentTaskIndexQueryKey(task.taskId), task);
  if (!task.sessionId) return;
  queryClient?.setQueryData(webActiveAgentTaskQueryKey(task.sessionId), task);
  writeStoredWebActiveAgentTask(task.sessionId, task);
}

export function readStoredWebActiveAgentTask(sessionId: string): WebActiveAgentTask | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(webActiveAgentTaskStorageKey(sessionId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const taskId = stringField(record.taskId);
    const status = stringField(record.status);
    if (!taskId || !status) return null;
    const storedSessionId = stringField(record.sessionId) ?? sessionId;
    const agentInstanceId = stringField(record.agentInstanceId);
    const triggerMessageId = stringField(record.triggerMessageId);
    const targetId = stringField(record.targetId);
    const edgeRunId = stringField(record.edgeRunId);
    const edgeDeviceId = stringField(record.edgeDeviceId);
    return compactActiveAgentTask({
      taskId,
      sessionId: storedSessionId,
      ...(agentInstanceId ? { agentInstanceId } : {}),
      ...(triggerMessageId ? { triggerMessageId } : {}),
      ...(targetId ? { targetId } : {}),
      ...(edgeRunId ? { edgeRunId } : {}),
      ...(edgeDeviceId ? { edgeDeviceId } : {}),
      status,
    });
  } catch {
    return null;
  }
}

function writeStoredWebActiveAgentTask(sessionId: string, task: WebActiveAgentTask): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(webActiveAgentTaskStorageKey(sessionId), JSON.stringify(compactActiveAgentTask(task)));
}

export function webActiveAgentTaskStorageKey(sessionId: string): string {
  return `agenthub.web.activeAgentTask.${sessionId}`;
}

export function compactActiveAgentTask(task: WebActiveAgentTask): WebActiveAgentTask {
  return {
    taskId: task.taskId,
    ...(task.sessionId ? { sessionId: task.sessionId } : {}),
    ...(task.agentInstanceId ? { agentInstanceId: task.agentInstanceId } : {}),
    ...(task.triggerMessageId ? { triggerMessageId: task.triggerMessageId } : {}),
    ...(task.targetId ? { targetId: task.targetId } : {}),
    ...(task.edgeRunId ? { edgeRunId: task.edgeRunId } : {}),
    ...(task.edgeDeviceId ? { edgeDeviceId: task.edgeDeviceId } : {}),
    status: task.status,
  };
}

export function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
