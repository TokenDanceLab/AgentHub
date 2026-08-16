import { describe, expect, it } from 'vitest';
import {
  createWorkbenchState,
  initialWorkbenchState,
  workbenchReducer,
  type WorkbenchState,
} from './workbenchState';
import type { AnyEvent } from './events';
import type { Approval, Artifact, Preview, Project, Run, Thread, ThreadItem } from './types';

const sentAt = '2026-05-24T10:00:00.000Z';

function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): AnyEvent {
  return {
    version: 'v1',
    id: `evt-${seq}`,
    seq,
    type,
    scope: {
      projectId: payload.projectId,
      threadId: payload.threadId,
      runId: payload.runId,
    },
    sentAt,
    payload,
  } as AnyEvent;
}

function reduceEvents(events: AnyEvent[], state = initialWorkbenchState) {
  return events.reduce<WorkbenchState>(
    (next, item) => workbenchReducer(next, { type: 'event.received', event: item }),
    state,
  );
}

describe('workbenchReducer', () => {
  it('loads an empty snapshot', () => {
    const state = createWorkbenchState();

    expect(state.projects).toEqual([]);
    expect(state.threads).toEqual([]);
    expect(state.runs).toEqual([]);
    expect(state.threadItems).toEqual([]);
    expect(state.approvals).toEqual([]);
    expect(state.artifacts).toEqual([]);
    expect(state.previews).toEqual([]);
    expect(state.connection.status).toBe('connected');
  });

  it('loads a normal REST snapshot', () => {
    const project: Project = {
      id: 'proj-1',
      name: 'AgentHub',
      createdAt: sentAt,
    };
    const thread: Thread = {
      id: 'thread-1',
      projectId: project.id,
      title: 'Wire Edge',
      status: 'active',
      createdAt: sentAt,
    };
    const run: Run = {
      runId: 'run-1',
      projectId: project.id,
      threadId: thread.id,
      status: 'running',
      createdAt: sentAt,
    };
    const item: ThreadItem = {
      id: 'item-1',
      threadId: thread.id,
      kind: 'message',
      role: 'agent',
      content: 'hello',
      createdAt: sentAt,
    };
    const approval: Approval = {
      id: 'approval-1',
      runId: run.runId,
      threadId: thread.id,
      kind: 'command',
      summary: 'Run command',
      status: 'pending',
      createdAt: sentAt,
    };
    const artifact: Artifact = {
      id: 'artifact-1',
      runId: run.runId,
      threadId: thread.id,
      kind: 'file',
      path: 'app/web/src/App.tsx',
      sizeBytes: 42,
      createdAt: sentAt,
    };
    const preview: Preview = {
      id: 'preview-1',
      runId: run.runId,
      threadId: thread.id,
      url: 'http://127.0.0.1:4173',
      status: 'ready',
      createdAt: sentAt,
    };

    const state = createWorkbenchState({
      projects: { items: [project], page: { hasMore: false } },
      threads: [thread],
      runs: { items: [run], page: { hasMore: false } },
      threadItems: [item],
      approvals: [approval],
      artifacts: [artifact],
      previews: [preview],
      runLogs: [{ runId: run.runId, stdout: 'ok', stderr: '' }],
    });

    expect(state.projects).toEqual([project]);
    expect(state.threads).toEqual([thread]);
    expect(state.runs).toEqual([run]);
    expect(state.threadItems).toEqual([item]);
    expect(state.approvals).toEqual([approval]);
    expect(state.artifacts).toEqual([artifact]);
    expect(state.previews).toEqual([preview]);
    expect(state.runLogs[run.runId]?.stdout).toBe('ok');
  });

  it('handles missing snapshot fields as empty collections', () => {
    const state = createWorkbenchState({
      projects: null,
      runs: undefined,
    });

    expect(state.projects).toEqual([]);
    expect(state.runs).toEqual([]);
    expect(state.connection.error).toBeUndefined();
  });

  it('composes run lifecycle, approval, artifact, and preview events', () => {
    const state = reduceEvents([
      event(1, 'run.queued', {
        runId: 'run-1',
        projectId: 'proj-1',
        threadId: 'thread-1',
      }),
      event(2, 'run.started', {
        runId: 'run-1',
        startedAt: '2026-05-24T10:01:00.000Z',
      }),
      event(3, 'run.output.batch', {
        runId: 'run-1',
        stream: 'stdout',
        chunks: [
          { offset: 0, text: 'hello ' },
          { offset: 6, text: 'world' },
        ],
      }),
      event(4, 'approval.requested', {
        approvalId: 'approval-1',
        runId: 'run-1',
        threadId: 'thread-1',
        kind: 'command',
        summary: 'Allow command?',
      }),
      event(5, 'approval.decided', {
        approvalId: 'approval-1',
        runId: 'run-1',
        decision: 'approved',
      }),
      event(6, 'artifact.created', {
        artifactId: 'artifact-1',
        runId: 'run-1',
        threadId: 'thread-1',
        kind: 'file',
        path: 'app/web/src/pages/workbench/WorkbenchPage.tsx',
        sizeBytes: 1024,
      }),
      event(7, 'preview.ready', {
        previewId: 'preview-1',
        runId: 'run-1',
        url: 'http://127.0.0.1:4173',
      }),
      event(8, 'preview.stopped', {
        previewId: 'preview-1',
        runId: 'run-1',
      }),
      event(9, 'run.finished', {
        runId: 'run-1',
        finishedAt: '2026-05-24T10:02:00.000Z',
      }),
    ]);

    expect(state.lastSeq).toBe(9);
    expect(state.runs[0]).toMatchObject({
      runId: 'run-1',
      status: 'finished',
      projectId: 'proj-1',
      threadId: 'thread-1',
    });
    expect(state.runLogs['run-1']?.stdout).toBe('hello world');
    expect(state.approvals[0]).toMatchObject({
      id: 'approval-1',
      status: 'approved',
    });
    expect(state.artifacts[0]?.path).toBe(
      'app/web/src/pages/workbench/WorkbenchPage.tsx',
    );
    expect(state.previews[0]).toMatchObject({
      id: 'preview-1',
      status: 'stopped',
    });
    expect(state.previews[0]?.url).toBeUndefined();
  });

  it('handles cancelled runs and truncated batched stderr output', () => {
    const state = reduceEvents([
      event(1, 'run.queued', {
        runId: 'run-1',
        projectId: 'proj-1',
        threadId: 'thread-1',
      }),
      event(2, 'run.output.batch', {
        runId: 'run-1',
        stream: 'stderr',
        chunks: [{ offset: 0, text: 'partial error' }],
        truncated: true,
        bytesWritten: 4194304,
        message: 'run output truncated after 4194304 bytes',
      }),
      event(3, 'run.cancelled', {
        runId: 'run-1',
        finishedAt: '2026-05-24T10:02:00.000Z',
      }),
    ]);

    expect(state.runs[0]).toMatchObject({
      runId: 'run-1',
      status: 'cancelled',
      finishedAt: '2026-05-24T10:02:00.000Z',
    });
    expect(state.runLogs['run-1']?.stdout).toBe('');
    expect(state.runLogs['run-1']?.stderr).toContain('partial error');
    expect(state.runLogs['run-1']?.stderr).toContain('output truncated');
  });

  it('keeps event state when a stale snapshot arrives after events', () => {
    const eventState = reduceEvents([
      event(1, 'message.created', {
        messageId: 'message-1',
        threadId: 'thread-1',
        role: 'agent',
        content: 'new event message',
      }),
      event(2, 'run.queued', {
        runId: 'run-1',
        projectId: 'proj-1',
        threadId: 'thread-1',
      }),
      event(3, 'run.started', {
        runId: 'run-1',
        startedAt: '2026-05-24T10:01:00.000Z',
      }),
      event(4, 'run.output', {
        runId: 'run-1',
        stream: 'stdout',
        text: 'new log',
      }),
      event(5, 'approval.requested', {
        approvalId: 'approval-1',
        runId: 'run-1',
        threadId: 'thread-1',
        kind: 'command',
        summary: 'Allow command?',
      }),
      event(6, 'approval.decided', {
        approvalId: 'approval-1',
        runId: 'run-1',
        decision: 'approved',
      }),
      event(7, 'run.finished', {
        runId: 'run-1',
        finishedAt: '2026-05-24T10:02:00.000Z',
      }),
    ]);

    const staleRun: Run = {
      runId: 'run-1',
      projectId: 'proj-1',
      threadId: 'thread-1',
      status: 'queued',
      createdAt: '2026-05-24T09:59:00.000Z',
    };
    const staleMessage: ThreadItem = {
      id: 'message-1',
      threadId: 'thread-1',
      kind: 'message',
      role: 'agent',
      content: 'old snapshot message',
      createdAt: '2026-05-24T09:59:00.000Z',
    };
    const staleApproval: Approval = {
      id: 'approval-1',
      runId: 'run-1',
      threadId: 'thread-1',
      kind: 'command',
      summary: 'Allow command?',
      status: 'pending',
      createdAt: '2026-05-24T09:59:00.000Z',
    };

    const state = workbenchReducer(eventState, {
      type: 'snapshot.loaded',
      snapshot: {
        projects: [{ id: 'proj-1', name: 'AgentHub', createdAt: sentAt }],
        threads: [
          {
            id: 'thread-1',
            projectId: 'proj-1',
            title: 'Validation',
            status: 'active',
            createdAt: sentAt,
          },
        ],
        runs: [staleRun],
        threadItems: [staleMessage],
        approvals: [staleApproval],
        runLogs: [{ runId: 'run-1', stdout: 'old log', stderr: '' }],
      },
    });

    expect(state.connection.status).toBe('connected');
    expect(state.lastSeq).toBe(7);
    expect(state.projects).toEqual([
      { id: 'proj-1', name: 'AgentHub', createdAt: sentAt },
    ]);
    expect(state.threads).toHaveLength(1);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({
      runId: 'run-1',
      status: 'finished',
      finishedAt: '2026-05-24T10:02:00.000Z',
    });
    expect(state.threadItems).toHaveLength(1);
    expect(state.threadItems[0]?.content).toBe('new event message');
    expect(state.approvals).toHaveLength(1);
    expect(state.approvals[0]).toMatchObject({
      id: 'approval-1',
      status: 'approved',
    });
    expect(state.runLogs['run-1']?.stdout).toBe('new log');
  });

  it('ignores duplicate, old, and unknown events without corrupting state', () => {
    const queued = event(10, 'run.queued', {
      runId: 'run-1',
      projectId: 'proj-1',
      threadId: 'thread-1',
    });
    const started = event(11, 'run.started', { runId: 'run-1' });
    const duplicate = event(11, 'run.finished', { runId: 'run-1' });
    const old = event(9, 'approval.requested', {
      approvalId: 'approval-old',
      runId: 'run-1',
      threadId: 'thread-1',
      kind: 'command',
      summary: 'old',
    });
    const unknown = event(12, 'run.teleported', {
      runId: 'run-1',
      status: 'banana',
    });

    const state = reduceEvents([queued, started, duplicate, old, unknown]);

    expect(state.lastSeq).toBe(12);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]?.status).toBe('running');
    expect(state.approvals).toEqual([]);
  });

  it('keeps snapshot data when disconnected and exposes the error', () => {
    const snapshot = createWorkbenchState({
      projects: [{ id: 'proj-1', name: 'AgentHub', createdAt: sentAt }],
    });

    const state = workbenchReducer(snapshot, {
      type: 'connection.disconnected',
      error: 'Edge WebSocket closed',
    });

    expect(state.projects).toHaveLength(1);
    expect(state.connection.status).toBe('disconnected');
    expect(state.connection.error).toBe('Edge WebSocket closed');
  });
});
