import type {
  Approval,
  ListResponse,
  Run,
  RunLogs,
  Thread,
  ThreadItem,
} from '../types';
import type {
  WorkbenchSnapshot,
  WorkbenchSnapshotData,
  WorkbenchState,
} from './workbenchStateTypes';

export const WORKBENCH_EPOCH = '1970-01-01T00:00:00.000Z';

export function withSeq(state: WorkbenchState, seq: number): WorkbenchState {
  return seq === state.lastSeq ? state : { ...state, lastSeq: seq };
}

export function list<T>(value: ListResponse<T> | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.items ?? [];
}

export function compact<T>(items: T[]): T[] {
  return items.filter(Boolean);
}

export function normalizeSnapshot(
  snapshot: WorkbenchSnapshot | null | undefined,
): WorkbenchSnapshotData {
  return {
    projects: compact(list(snapshot?.projects)),
    threads: compact(list(snapshot?.threads)),
    runners: compact(list(snapshot?.runners)),
    runs: compact(list(snapshot?.runs)),
    threadItems: compact(list(snapshot?.threadItems)),
    approvals: compact(list(snapshot?.approvals)),
    artifacts: compact(list(snapshot?.artifacts)),
    previews: compact(list(snapshot?.previews)),
    runLogs: keyRunLogs(snapshot?.runLogs),
  };
}

export function isEmptyWorkbenchData(state: WorkbenchState): boolean {
  return (
    state.lastSeq === 0 &&
    state.projects.length === 0 &&
    state.threads.length === 0 &&
    state.runners.length === 0 &&
    state.runs.length === 0 &&
    state.threadItems.length === 0 &&
    state.approvals.length === 0 &&
    state.artifacts.length === 0 &&
    state.previews.length === 0 &&
    Object.keys(state.runLogs).length === 0
  );
}

export function mergeByKey<T>(
  snapshotItems: T[],
  currentItems: T[],
  keyOf: (item: T) => string | undefined,
): T[] {
  const currentKeys = new Set(currentItems.map(keyOf).filter(Boolean));
  return [
    ...snapshotItems.filter((item) => {
      const key = keyOf(item);
      return key && !currentKeys.has(key);
    }),
    ...currentItems,
  ];
}

export function upsertBy<T extends { id?: string; runId?: string }>(
  items: T[],
  id: string,
  build: (current?: T) => T,
): T[] {
  const index = items.findIndex((item) => item.id === id || item.runId === id);
  if (index === -1) {
    return [...items, build()];
  }

  const next = [...items];
  next[index] = build(items[index]);
  return next;
}

export function keyRunLogs(logs: RunLogs[] | null | undefined): Record<string, RunLogs> {
  return (logs ?? []).reduce<Record<string, RunLogs>>((acc, log) => {
    if (log?.runId) {
      acc[log.runId] = log;
    }
    return acc;
  }, {});
}

export function threadItemFromMessage(
  payload: Record<string, unknown>,
  createdAt: string,
): ThreadItem | null {
  const id = text(payload.messageId);
  const threadId = text(payload.threadId);
  const itemRole = role(payload.role);
  if (!id || !threadId || !itemRole) return null;

  return {
    id,
    threadId,
    kind: 'message',
    role: itemRole,
    content: text(payload.content) ?? '',
    createdAt: text(payload.createdAt) ?? createdAt,
  };
}

export function setRunStatus(runs: Run[], runId: string, status: Run['status']): Run[] {
  return upsertBy(runs, runId, (current) => ({
    runId,
    projectId: current?.projectId ?? '',
    threadId: current?.threadId ?? '',
    status,
    createdAt: current?.createdAt ?? WORKBENCH_EPOCH,
    ...optionalString('startedAt', current?.startedAt),
    ...optionalString('finishedAt', current?.finishedAt),
  }));
}

export function chunkTexts(
  value: unknown,
  fallbackStream?: string,
): Array<{ stream?: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((chunk) => {
    if (chunk && typeof chunk === 'object') {
      const record = chunk as Record<string, unknown>;
      return chunkText(text(record.text) ?? '', text(record.stream) ?? fallbackStream);
    }
    return chunkText('', fallbackStream);
  });
}

export function chunkText(
  textValue: string,
  stream?: string,
): { stream?: string; text: string } {
  return {
    text: textValue,
    ...(stream ? { stream } : {}),
  };
}

export function optionalString<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  return value ? ({ [key]: value } as Record<K, string>) : {};
}

export function truncationNotice(payload: Record<string, unknown>): string | undefined {
  if (payload.truncated !== true) return undefined;
  const bytesWritten = number(payload.bytesWritten);
  const bytesBefore = number(payload.bytesBefore);
  const maxBytes = number(payload.maxBytes);
  const suffix =
    bytesWritten !== undefined
      ? ` after ${bytesWritten} bytes`
      : bytesBefore !== undefined
        ? ` after ${bytesBefore} bytes`
        : maxBytes !== undefined
          ? ` at ${maxBytes} bytes`
          : '';
  const message = text(payload.message);
  return `\n[output truncated${suffix}${message ? `: ${message}` : ''}]\n`;
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function role(value: unknown): ThreadItem['role'] | undefined {
  return value === 'user' || value === 'agent' ? value : undefined;
}

export function threadStatus(value: unknown): Thread['status'] | undefined {
  return value === 'active' || value === 'archived' ? value : undefined;
}

export function threadItemKind(value: unknown): ThreadItem['kind'] | undefined {
  return value === 'message' ||
    value === 'code' ||
    value === 'file' ||
    value === 'diff' ||
    value === 'approval'
    ? value
    : undefined;
}

export function runStatus(
  eventType: string,
  value: unknown,
): Run['status'] | undefined {
  if (
    value === 'queued' ||
    value === 'starting' ||
    value === 'running' ||
    value === 'waiting_approval' ||
    value === 'finished' ||
    value === 'failed' ||
    value === 'cancelled'
  ) {
    return value;
  }

  if (eventType === 'run.queued') return 'queued';
  if (eventType === 'run.started') return 'running';
  if (eventType === 'run.finished') return 'finished';
  if (eventType === 'run.failed') return 'failed';
  if (eventType === 'run.cancelled') return 'cancelled';
  return undefined;
}

export function approvalKind(value: unknown): Approval['kind'] | undefined {
  return value === 'file_write' || value === 'command' || value === 'publish'
    ? value
    : undefined;
}

export function decision(value: unknown): Approval['status'] | undefined {
  return value === 'approved' || value === 'rejected' ? value : undefined;
}
