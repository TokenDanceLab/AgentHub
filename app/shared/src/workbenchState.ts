import type { AnyEvent, EventEnvelope } from './events';
import type {
  Approval,
  Artifact,
  ListResponse,
  Preview,
  Project,
  Run,
  RunLogs,
  Runner,
  Thread,
  ThreadItem,
} from './types';

export type WorkbenchConnectionStatus =
  | 'idle'
  | 'loading'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface WorkbenchSnapshot {
  projects?: ListResponse<Project> | Project[] | null;
  threads?: ListResponse<Thread> | Thread[] | null;
  runners?: ListResponse<Runner> | Runner[] | null;
  runs?: ListResponse<Run> | Run[] | null;
  threadItems?: ListResponse<ThreadItem> | ThreadItem[] | null;
  approvals?: ListResponse<Approval> | Approval[] | null;
  artifacts?: ListResponse<Artifact> | Artifact[] | null;
  previews?: ListResponse<Preview> | Preview[] | null;
  runLogs?: RunLogs[] | null;
}

export interface WorkbenchState {
  projects: Project[];
  threads: Thread[];
  runners: Runner[];
  runs: Run[];
  threadItems: ThreadItem[];
  approvals: Approval[];
  artifacts: Artifact[];
  previews: Preview[];
  runLogs: Record<string, RunLogs>;
  connection: {
    status: WorkbenchConnectionStatus;
    error?: string;
  };
  lastSeq: number;
}

export type WorkbenchAction =
  | { type: 'snapshot.loaded'; snapshot?: WorkbenchSnapshot | null }
  | { type: 'threadItems.loaded'; threadItems?: ListResponse<ThreadItem> | ThreadItem[] | null }
  | { type: 'connection.loading' }
  | { type: 'connection.connected' }
  | { type: 'connection.disconnected'; error?: string }
  | { type: 'connection.error'; error: string }
  | { type: 'event.received'; event: AnyEvent };

const EPOCH = '1970-01-01T00:00:00.000Z';

export const initialWorkbenchState: WorkbenchState = {
  projects: [],
  threads: [],
  runners: [],
  runs: [],
  threadItems: [],
  approvals: [],
  artifacts: [],
  previews: [],
  runLogs: {},
  connection: { status: 'idle' },
  lastSeq: 0,
};

export function createWorkbenchState(
  snapshot?: WorkbenchSnapshot | null,
): WorkbenchState {
  return workbenchReducer(initialWorkbenchState, {
    type: 'snapshot.loaded',
    ...(snapshot !== undefined ? { snapshot } : {}),
  });
}

export function workbenchReducer(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  switch (action.type) {
    case 'snapshot.loaded': {
      const snapshot = normalizeSnapshot(action.snapshot);
      if (isEmptyWorkbenchData(state)) {
        return {
          ...state,
          ...snapshot,
          connection: { status: 'connected' },
        };
      }

      return {
        ...state,
        projects: mergeByKey(snapshot.projects, state.projects, (project) => project.id),
        threads: mergeByKey(snapshot.threads, state.threads, (thread) => thread.id),
        runners: mergeByKey(snapshot.runners, state.runners, (runner) => runner.id),
        runs: mergeByKey(snapshot.runs, state.runs, (run) => run.runId),
        threadItems: mergeByKey(snapshot.threadItems, state.threadItems, (item) => item.id),
        approvals: mergeByKey(snapshot.approvals, state.approvals, (approval) => approval.id),
        artifacts: mergeByKey(snapshot.artifacts, state.artifacts, (artifact) => artifact.id),
        previews: mergeByKey(snapshot.previews, state.previews, (preview) => preview.id),
        runLogs: { ...snapshot.runLogs, ...state.runLogs },
        connection: { status: 'connected' },
      };
    }
    case 'threadItems.loaded':
      return {
        ...state,
        threadItems: compact(list(action.threadItems)),
      };
    case 'connection.loading':
      return {
        ...state,
        connection: { status: 'loading' },
      };
    case 'connection.connected':
      return {
        ...state,
        connection: { status: 'connected' },
      };
    case 'connection.disconnected':
      return {
        ...state,
        connection: {
          status: 'disconnected',
          ...(action.error !== undefined ? { error: action.error } : {}),
        },
      };
    case 'connection.error':
      return {
        ...state,
        connection: { status: 'error', error: action.error },
      };
    case 'event.received':
      return applyEvent(state, action.event);
    default:
      return state;
  }
}

function applyEvent(state: WorkbenchState, event: AnyEvent): WorkbenchState {
  const envelope = event as EventEnvelope;

  if (envelope.seq && envelope.seq <= state.lastSeq) {
    return state;
  }

  const nextSeq = envelope.seq || state.lastSeq;
  const payload = event.payload ?? {};
  const sentAt = envelope.sentAt || new Date().toISOString();

  switch (event.type) {
    case 'project.created':
    case 'project.updated': {
      const projectId = text(payload.projectId) ?? text(envelope.scope?.projectId);
      if (!projectId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        projects: upsertBy(state.projects, projectId, (current) => ({
          id: projectId,
          name: text(payload.name) ?? current?.name ?? projectId,
          ...(text(payload.description) ?? current?.description
            ? { description: text(payload.description) ?? current?.description }
            : {}),
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
          updatedAt: text(payload.updatedAt) ?? sentAt,
        })),
      };
    }
    case 'thread.created':
    case 'thread.updated': {
      const threadId = text(payload.threadId) ?? text(envelope.scope?.threadId);
      if (!threadId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        threads: upsertBy(state.threads, threadId, (current) => ({
          id: threadId,
          projectId:
            text(payload.projectId) ??
            text(envelope.scope?.projectId) ??
            current?.projectId ??
            '',
          ...(text(payload.conversationId) ?? current?.conversationId
            ? { conversationId: text(payload.conversationId) ?? current?.conversationId }
            : {}),
          ...(text(payload.title) ?? current?.title
            ? { title: text(payload.title) ?? current?.title }
            : {}),
          status: threadStatus(payload.status) ?? current?.status ?? 'active',
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
          updatedAt: text(payload.updatedAt) ?? sentAt,
        })),
      };
    }
    case 'message.created': {
      const item = threadItemFromMessage(payload, sentAt);
      if (!item) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        threadItems: upsertBy(state.threadItems, item.id, () => item),
      };
    }
    case 'message.delta': {
      const itemId = text(payload.messageId);
      const threadId = text(payload.threadId);
      const delta = text(payload.delta) ?? '';
      if (!itemId || !threadId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        threadItems: upsertBy(state.threadItems, itemId, (current) => ({
          id: itemId,
          threadId,
          kind: 'message',
          role: current?.role ?? 'agent',
          content: `${current?.content ?? ''}${delta}`,
          createdAt: current?.createdAt ?? sentAt,
        })),
      };
    }
    case 'item.created':
    case 'item.updated': {
      const itemId = text(payload.itemId);
      const threadId = text(payload.threadId) ?? text(envelope.scope?.threadId);
      if (!itemId || !threadId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        threadItems: upsertBy(state.threadItems, itemId, (current) => ({
          id: itemId,
          threadId,
          kind: threadItemKind(payload.kind) ?? current?.kind ?? 'message',
          role: role(payload.role) ?? current?.role ?? 'agent',
          content: text(payload.content) ?? current?.content ?? '',
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
        })),
      };
    }
    case 'runner.online':
    case 'runner.offline': {
      const runnerId = text(payload.runnerId);
      if (!runnerId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        runners: upsertBy(state.runners, runnerId, (current) => ({
          id: runnerId,
          name: text(payload.name) ?? current?.name ?? runnerId,
          status: event.type === 'runner.online' ? 'online' : 'offline',
          ...(text(payload.capabilities) ?? current?.capabilities
            ? { capabilities: text(payload.capabilities) ?? current?.capabilities }
            : {}),
        })),
      };
    }
    case 'run.queued':
    case 'run.started':
    case 'run.status.changed':
    case 'run.finished':
    case 'run.failed':
    case 'run.cancelled': {
      const runId = text(payload.runId) ?? text(envelope.scope?.runId);
      if (!runId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        runs: upsertBy(state.runs, runId, (current) => ({
          runId,
          projectId:
            text(payload.projectId) ??
            text(envelope.scope?.projectId) ??
            current?.projectId ??
            '',
          threadId:
            text(payload.threadId) ??
            text(envelope.scope?.threadId) ??
            current?.threadId ??
            '',
          status: runStatus(event.type, payload.status) ?? current?.status ?? 'queued',
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
          ...(text(payload.startedAt) ?? current?.startedAt
            ? { startedAt: text(payload.startedAt) ?? current?.startedAt }
            : {}),
          ...(text(payload.finishedAt) ?? current?.finishedAt
            ? { finishedAt: text(payload.finishedAt) ?? current?.finishedAt }
            : {}),
        })),
      };
    }
    case 'run.output':
    case 'run.output.batch': {
      const runId = text(payload.runId) ?? text(envelope.scope?.runId);
      if (!runId) return withSeq(state, nextSeq);

      const current = state.runLogs[runId] ?? {
        runId,
        stdout: '',
        stderr: '',
      };
      const chunks =
        event.type === 'run.output.batch'
          ? chunkTexts(payload.chunks, text(payload.stream))
          : [logChunk(text(payload.text) ?? '', text(payload.stream))];
      const notice = truncationNotice(payload);
      if (notice) {
        chunks.push(logChunk(notice, text(payload.stream)));
      }
      const nextLog = chunks.reduce<RunLogs>((acc, chunk) => {
        if (chunk.stream === 'stderr') {
          return { ...acc, stderr: `${acc.stderr}${chunk.text}` };
        }
        return { ...acc, stdout: `${acc.stdout}${chunk.text}` };
      }, current);

      return {
        ...state,
        lastSeq: nextSeq,
        runLogs: { ...state.runLogs, [runId]: nextLog },
      };
    }
    case 'approval.requested': {
      const approvalId = text(payload.approvalId);
      const runId = text(payload.runId) ?? text(envelope.scope?.runId);
      const threadId = text(payload.threadId) ?? text(envelope.scope?.threadId);
      if (!approvalId || !runId || !threadId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        runs: setRunStatus(state.runs, runId, 'waiting_approval'),
        approvals: upsertBy(state.approvals, approvalId, (current) => ({
          id: approvalId,
          runId,
          threadId,
          kind: approvalKind(payload.kind) ?? current?.kind ?? 'command',
          summary: text(payload.summary) ?? current?.summary ?? 'Approval required',
          status: 'pending',
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
          ...(current?.decidedAt ? { decidedAt: current.decidedAt } : {}),
        })),
      };
    }
    case 'approval.decided': {
      const approvalId = text(payload.approvalId);
      if (!approvalId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        approvals: state.approvals.map((approval) =>
          approval.id === approvalId
            ? {
                ...approval,
                status: decision(payload.decision) ?? approval.status,
                decidedAt: text(payload.decidedAt) ?? sentAt,
              }
            : approval,
        ),
      };
    }
    case 'artifact.created': {
      const artifactId = text(payload.artifactId);
      const runId = text(payload.runId) ?? text(envelope.scope?.runId);
      const threadId = text(payload.threadId) ?? text(envelope.scope?.threadId);
      if (!artifactId || !runId || !threadId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        artifacts: upsertBy(state.artifacts, artifactId, (current) => ({
          id: artifactId,
          runId,
          threadId,
          kind: text(payload.kind) ?? current?.kind ?? 'file',
          path: text(payload.path) ?? current?.path ?? artifactId,
          sizeBytes: number(payload.sizeBytes) ?? current?.sizeBytes ?? 0,
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
        })),
      };
    }
    case 'preview.ready': {
      const previewId = text(payload.previewId);
      const runId = text(payload.runId) ?? text(envelope.scope?.runId);
      if (!previewId || !runId) return withSeq(state, nextSeq);
      const run = state.runs.find((candidate) => candidate.runId === runId);

      return {
        ...state,
        lastSeq: nextSeq,
        previews: upsertBy(state.previews, previewId, (current) => ({
          id: previewId,
          runId,
          threadId: text(payload.threadId) ?? current?.threadId ?? run?.threadId ?? '',
          ...(text(payload.url) ?? current?.url
            ? { url: text(payload.url) ?? current?.url }
            : {}),
          status: 'ready',
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
        })),
      };
    }
    case 'error':
      return {
        ...state,
        lastSeq: nextSeq,
        connection: {
          status: 'error',
          error: text(payload.message) ?? text(payload.code) ?? 'Unknown Edge error',
        },
      };
    default:
      return withSeq(state, nextSeq);
  }
}

function withSeq(state: WorkbenchState, seq: number): WorkbenchState {
  return seq === state.lastSeq ? state : { ...state, lastSeq: seq };
}

function list<T>(value: ListResponse<T> | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.items ?? [];
}

function compact<T>(items: T[]): T[] {
  return items.filter(Boolean);
}

function normalizeSnapshot(
  snapshot: WorkbenchSnapshot | null | undefined,
): Pick<
  WorkbenchState,
  | 'projects'
  | 'threads'
  | 'runners'
  | 'runs'
  | 'threadItems'
  | 'approvals'
  | 'artifacts'
  | 'previews'
  | 'runLogs'
> {
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

function isEmptyWorkbenchData(state: WorkbenchState): boolean {
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

function mergeByKey<T>(
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

function upsertBy<T extends { id?: string; runId?: string }>(
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

function keyRunLogs(logs: RunLogs[] | null | undefined): Record<string, RunLogs> {
  return (logs ?? []).reduce<Record<string, RunLogs>>((acc, log) => {
    if (log?.runId) {
      acc[log.runId] = log;
    }
    return acc;
  }, {});
}

function threadItemFromMessage(
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

function setRunStatus(runs: Run[], runId: string, status: Run['status']): Run[] {
  return upsertBy(runs, runId, (current) => ({
    runId,
    projectId: current?.projectId ?? '',
    threadId: current?.threadId ?? '',
    status,
    createdAt: current?.createdAt ?? EPOCH,
    ...(current?.startedAt ? { startedAt: current.startedAt } : {}),
    ...(current?.finishedAt ? { finishedAt: current.finishedAt } : {}),
  }));
}

function logChunk(
  chunkText: string,
  stream?: string,
): { stream?: string; text: string } {
  return {
    text: chunkText,
    ...(stream !== undefined ? { stream } : {}),
  };
}

function chunkTexts(
  value: unknown,
  fallbackStream?: string,
): Array<{ stream?: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((chunk) => {
    if (chunk && typeof chunk === 'object') {
      const record = chunk as Record<string, unknown>;
      return logChunk(text(record.text) ?? '', text(record.stream) ?? fallbackStream);
    }
    return logChunk('', fallbackStream);
  });
}

function truncationNotice(payload: Record<string, unknown>): string | undefined {
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

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function role(value: unknown): ThreadItem['role'] | undefined {
  return value === 'user' || value === 'agent' ? value : undefined;
}

function threadStatus(value: unknown): Thread['status'] | undefined {
  return value === 'active' || value === 'archived' ? value : undefined;
}

function threadItemKind(value: unknown): ThreadItem['kind'] | undefined {
  return value === 'message' ||
    value === 'code' ||
    value === 'file' ||
    value === 'diff' ||
    value === 'approval'
    ? value
    : undefined;
}

function runStatus(
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

function approvalKind(value: unknown): Approval['kind'] | undefined {
  return value === 'file_write' || value === 'command' || value === 'publish'
    ? value
    : undefined;
}

function decision(value: unknown): Approval['status'] | undefined {
  return value === 'approved' || value === 'rejected' ? value : undefined;
}
