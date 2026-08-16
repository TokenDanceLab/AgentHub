import type { AnyEvent } from '../events';
import type { RunLogs } from '../types';
import {
  approvalKind,
  chunkText,
  chunkTexts,
  decision,
  number,
  optionalString,
  role,
  runStatus,
  setRunStatus,
  text,
  threadItemFromMessage,
  threadItemKind,
  threadStatus,
  truncationNotice,
  upsertBy,
  withSeq,
} from './workbenchStateHelpers';
import type { WorkbenchState } from './workbenchStateTypes';

export function applyEvent(state: WorkbenchState, event: AnyEvent): WorkbenchState {
  if (event.seq && event.seq <= state.lastSeq) {
    return state;
  }

  const nextSeq = event.seq || state.lastSeq;
  const sentAt = event.sentAt || new Date().toISOString();

  switch (event.type) {
    case 'project.created':
    case 'project.updated': {
      const payload = event.payload;
      const projectId = text(payload.projectId) ?? text(event.scope?.projectId);
      if (!projectId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        projects: upsertBy(state.projects, projectId, (current) => ({
          id: projectId,
          name: text(payload.name) ?? current?.name ?? projectId,
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
          ...optionalString('description', text(payload.description) ?? current?.description),
          ...optionalString('updatedAt', text(payload.updatedAt) ?? sentAt),
        })),
      };
    }
    case 'thread.created':
    case 'thread.updated': {
      const payload = event.payload;
      const threadId = text(payload.threadId) ?? text(event.scope?.threadId);
      if (!threadId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        threads: upsertBy(state.threads, threadId, (current) => ({
          id: threadId,
          projectId:
            text(payload.projectId) ??
            text(event.scope?.projectId) ??
            current?.projectId ??
            '',
          status: threadStatus(payload.status) ?? current?.status ?? 'active',
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
          ...optionalString('conversationId', text(payload.conversationId) ?? current?.conversationId),
          ...optionalString('title', text(payload.title) ?? current?.title),
          ...optionalString('updatedAt', text(payload.updatedAt) ?? sentAt),
        })),
      };
    }
    case 'message.created': {
      const payload = event.payload;
      const item = threadItemFromMessage(payload, sentAt);
      if (!item) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        threadItems: upsertBy(state.threadItems, item.id, () => item),
      };
    }
    case 'message.delta': {
      const payload = event.payload;
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
      const payload = event.payload;
      const itemId = text(payload.itemId);
      const threadId = text(payload.threadId) ?? text(event.scope?.threadId);
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
      const payload = event.payload;
      const runnerId = text(payload.runnerId);
      if (!runnerId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        runners: upsertBy(state.runners, runnerId, (current) => ({
          id: runnerId,
          name: text(payload.name) ?? current?.name ?? runnerId,
          status: event.type === 'runner.online' ? 'online' : 'offline',
          ...optionalString('capabilities', text(payload.capabilities) ?? current?.capabilities),
        })),
      };
    }
    case 'run.queued':
    case 'run.started':
    case 'run.status.changed':
    case 'run.finished':
    case 'run.failed':
    case 'run.cancelled': {
      const payload = event.payload;
      const runId = text(payload.runId) ?? text(event.scope?.runId);
      if (!runId) return withSeq(state, nextSeq);

      return {
        ...state,
        lastSeq: nextSeq,
        runs: upsertBy(state.runs, runId, (current) => ({
          runId,
          projectId:
            text(payload.projectId) ??
            text(event.scope?.projectId) ??
            current?.projectId ??
            '',
          threadId:
            text(payload.threadId) ??
            text(event.scope?.threadId) ??
            current?.threadId ??
            '',
          status: runStatus(event.type, payload.status) ?? current?.status ?? 'queued',
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
          ...optionalString('startedAt', text(payload.startedAt) ?? current?.startedAt),
          ...optionalString('finishedAt', text(payload.finishedAt) ?? current?.finishedAt),
        })),
      };
    }
    case 'run.output':
    case 'run.output.batch': {
      const payload = event.payload;
      const runId = text(payload.runId) ?? text(event.scope?.runId);
      if (!runId) return withSeq(state, nextSeq);

      const current = state.runLogs[runId] ?? {
        runId,
        stdout: '',
        stderr: '',
      };
      const chunks =
        event.type === 'run.output.batch'
          ? chunkTexts(payload.chunks, text(payload.stream))
          : [chunkText(text(payload.text) ?? '', text(payload.stream))];
      const notice = truncationNotice(payload);
      if (notice) {
        chunks.push(chunkText(notice, text(payload.stream)));
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
      const payload = event.payload;
      const approvalId = text(payload.approvalId);
      const runId = text(payload.runId) ?? text(event.scope?.runId);
      const threadId = text(payload.threadId) ?? text(event.scope?.threadId);
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
      const payload = event.payload;
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
      const payload = event.payload;
      const artifactId = text(payload.artifactId);
      const runId = text(payload.runId) ?? text(event.scope?.runId);
      const threadId = text(payload.threadId) ?? text(event.scope?.threadId);
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
      const payload = event.payload;
      const previewId = text(payload.previewId);
      const runId = text(payload.runId) ?? text(event.scope?.runId);
      if (!previewId || !runId) return withSeq(state, nextSeq);
      const run = state.runs.find((candidate) => candidate.runId === runId);

      return {
        ...state,
        lastSeq: nextSeq,
        previews: upsertBy(state.previews, previewId, (current) => ({
          id: previewId,
          runId,
          threadId: text(payload.threadId) ?? current?.threadId ?? run?.threadId ?? '',
          status: 'ready',
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
          ...optionalString('url', text(payload.url) ?? current?.url),
        })),
      };
    }
    case 'preview.stopped': {
      const payload = event.payload;
      const previewId = text(payload.previewId);
      const runId = text(payload.runId) ?? text(event.scope?.runId);
      if (!previewId || !runId) return withSeq(state, nextSeq);
      const run = state.runs.find((candidate) => candidate.runId === runId);

      return {
        ...state,
        lastSeq: nextSeq,
        previews: upsertBy(state.previews, previewId, (current) => ({
          id: previewId,
          runId,
          threadId: text(payload.threadId) ?? current?.threadId ?? run?.threadId ?? '',
          status: 'stopped',
          createdAt: text(payload.createdAt) ?? current?.createdAt ?? sentAt,
        })),
      };
    }
    case 'error': {
      const payload = event.payload;
      return {
        ...state,
        lastSeq: nextSeq,
        connection: {
          status: 'error',
          error: text(payload.message) ?? text(payload.code) ?? 'Unknown Edge error',
        },
      };
    }
    default:
      return withSeq(state, nextSeq);
  }
}
