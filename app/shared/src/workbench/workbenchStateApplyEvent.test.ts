import { describe, expect, it } from 'vitest';
import type { AnyEvent } from '../events';
import { initialWorkbenchState } from './workbenchState';
import { applyEvent } from './workbenchStateApplyEvent';
import type { WorkbenchState } from './workbenchStateTypes';

const sentAt = '2026-05-24T10:00:00.000Z';

function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  scope: Record<string, unknown> = {},
): AnyEvent {
  return {
    version: 'v1',
    id: `evt-${seq}`,
    seq,
    type,
    scope,
    sentAt,
    payload,
  } as unknown as AnyEvent;
}

function applyAll(events: AnyEvent[], state: WorkbenchState = initialWorkbenchState): WorkbenchState {
  return events.reduce<WorkbenchState>((next, evt) => applyEvent(next, evt), state);
}

describe('applyEvent', () => {
  describe('sequence handling', () => {
    it('ignores events with seq at or below lastSeq', () => {
      const seeded: WorkbenchState = { ...initialWorkbenchState, lastSeq: 5 };
      const stale = applyEvent(seeded, event(5, 'project.created', { projectId: 'p-late' }));
      expect(stale).toBe(seeded);
      expect(stale.projects).toHaveLength(0);
    });

    it('advances lastSeq even for unknown event types', () => {
      const next = applyEvent(initialWorkbenchState, event(3, 'some.unknown.type', {}));
      expect(next.lastSeq).toBe(3);
      expect(next.projects).toHaveLength(0);
    });

    it('falls back to lastSeq when event has no seq', () => {
      const seeded: WorkbenchState = { ...initialWorkbenchState, lastSeq: 7 };
      const noSeq = { ...event(0, 'project.created', { projectId: 'p-1' }) } as AnyEvent;
      (noSeq as { seq?: number }).seq = undefined;
      const next = applyEvent(seeded, noSeq);
      expect(next.lastSeq).toBe(7);
      expect(next.projects).toHaveLength(1);
    });
  });

  describe('projects and threads', () => {
    it('creates a project and upserts by id on update', () => {
      const state = applyAll([
        event(1, 'project.created', { projectId: 'p-1', name: 'AgentHub' }),
        event(2, 'project.updated', { projectId: 'p-1', name: 'AgentHub 2', description: 'd' }),
      ]);
      expect(state.projects).toHaveLength(1);
      expect(state.projects[0].id).toBe('p-1');
      expect(state.projects[0].name).toBe('AgentHub 2');
      expect(state.projects[0].description).toBe('d');
    });

    it('resolves projectId from scope when payload omits it', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(1, 'project.created', { name: 'Scoped' }, { projectId: 'p-scope' }),
      );
      expect(state.projects[0].id).toBe('p-scope');
    });

    it('skips project events without any resolvable id but still bumps seq', () => {
      const state = applyEvent(initialWorkbenchState, event(1, 'project.created', { name: 'NoId' }));
      expect(state.projects).toHaveLength(0);
      expect(state.lastSeq).toBe(1);
    });

    it('creates a thread with active default status', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(1, 'thread.created', { threadId: 't-1', projectId: 'p-1', title: 'Hello' }),
      );
      expect(state.threads).toHaveLength(1);
      expect(state.threads[0]).toMatchObject({
        id: 't-1',
        projectId: 'p-1',
        status: 'active',
        title: 'Hello',
      });
    });
  });

  describe('messages and deltas', () => {
    it('creates a thread item from message.created', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(1, 'message.created', {
          messageId: 'm-1',
          threadId: 't-1',
          role: 'user',
          content: 'hi',
        }),
      );
      expect(state.threadItems).toHaveLength(1);
      expect(state.threadItems[0]).toMatchObject({
        id: 'm-1',
        threadId: 't-1',
        role: 'user',
        content: 'hi',
        kind: 'message',
      });
    });

    it('appends message.delta to existing item content', () => {
      const state = applyAll([
        event(1, 'message.created', { messageId: 'm-1', threadId: 't-1', role: 'agent', content: 'Hel' }),
        event(2, 'message.delta', { messageId: 'm-1', threadId: 't-1', delta: 'lo' }),
      ]);
      expect(state.threadItems).toHaveLength(1);
      expect(state.threadItems[0].content).toBe('Hello');
    });

    it('creates the item on delta when it does not exist yet', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(1, 'message.delta', { messageId: 'm-new', threadId: 't-1', delta: 'first' }),
      );
      expect(state.threadItems).toHaveLength(1);
      expect(state.threadItems[0].content).toBe('first');
      expect(state.threadItems[0].role).toBe('agent');
    });

    it('ignores message.created missing role', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(1, 'message.created', { messageId: 'm-1', threadId: 't-1', content: 'x' }),
      );
      expect(state.threadItems).toHaveLength(0);
      expect(state.lastSeq).toBe(1);
    });
  });

  describe('run lifecycle', () => {
    it('derives status from event type when payload.status is absent', () => {
      const state = applyAll([
        event(1, 'run.queued', { runId: 'r-1', projectId: 'p-1', threadId: 't-1' }),
        event(2, 'run.started', { runId: 'r-1' }),
        event(3, 'run.finished', { runId: 'r-1', finishedAt: '2026-05-24T10:05:00.000Z' }),
      ]);
      expect(state.runs).toHaveLength(1);
      expect(state.runs[0].status).toBe('finished');
      expect(state.runs[0].finishedAt).toBe('2026-05-24T10:05:00.000Z');
    });

    it('prefers explicit payload.status over event-type derivation', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(1, 'run.status.changed', { runId: 'r-1', status: 'waiting_approval' }),
      );
      expect(state.runs[0].status).toBe('waiting_approval');
    });
  });

  describe('run output logs', () => {
    it('appends stdout and stderr to run logs', () => {
      const state = applyAll([
        event(1, 'run.output', { runId: 'r-1', text: 'out-1', stream: 'stdout' }),
        event(2, 'run.output', { runId: 'r-1', text: 'err-1', stream: 'stderr' }),
        event(3, 'run.output', { runId: 'r-1', text: 'out-2' }),
      ]);
      const log = state.runLogs['r-1'];
      expect(log.stdout).toBe('out-1out-2');
      expect(log.stderr).toBe('err-1');
    });

    it('handles run.output.batch chunks and truncation notice', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(1, 'run.output.batch', {
          runId: 'r-1',
          stream: 'stdout',
          chunks: [{ text: 'a' }, { text: 'b', stream: 'stderr' }],
          truncated: true,
          bytesWritten: 42,
        }),
      );
      const log = state.runLogs['r-1'];
      expect(log.stdout).toContain('a');
      expect(log.stdout).toContain('[output truncated after 42 bytes]');
      expect(log.stderr).toBe('b');
    });
  });

  describe('approvals', () => {
    it('marks run waiting_approval and adds a pending approval', () => {
      const state = applyAll([
        event(1, 'run.started', { runId: 'r-1', projectId: 'p-1', threadId: 't-1' }),
        event(2, 'approval.requested', {
          approvalId: 'a-1',
          runId: 'r-1',
          threadId: 't-1',
          kind: 'command',
          summary: 'Run rm?',
        }),
      ]);
      expect(state.runs[0].status).toBe('waiting_approval');
      expect(state.approvals).toHaveLength(1);
      expect(state.approvals[0]).toMatchObject({
        id: 'a-1',
        runId: 'r-1',
        kind: 'command',
        status: 'pending',
        summary: 'Run rm?',
      });
    });

    it('records decision and decidedAt on approval.decided', () => {
      const state = applyAll([
        event(1, 'approval.requested', { approvalId: 'a-1', runId: 'r-1', threadId: 't-1' }),
        event(2, 'approval.decided', { approvalId: 'a-1', decision: 'approved' }),
      ]);
      expect(state.approvals[0].status).toBe('approved');
      expect(state.approvals[0].decidedAt).toBe(sentAt);
    });

    it('keeps unknown decision values unchanged', () => {
      const state = applyAll([
        event(1, 'approval.requested', { approvalId: 'a-1', runId: 'r-1', threadId: 't-1' }),
        event(2, 'approval.decided', { approvalId: 'a-1', decision: 'maybe' }),
      ]);
      expect(state.approvals[0].status).toBe('pending');
    });
  });

  describe('artifacts and previews', () => {
    it('creates an artifact with defaults', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(1, 'artifact.created', {
          artifactId: 'art-1',
          runId: 'r-1',
          threadId: 't-1',
          path: '/tmp/out.txt',
          sizeBytes: 128,
        }),
      );
      expect(state.artifacts[0]).toMatchObject({
        id: 'art-1',
        kind: 'file',
        path: '/tmp/out.txt',
        sizeBytes: 128,
      });
    });

    it('toggles preview ready then stopped, inheriting threadId from run', () => {
      const state = applyAll([
        event(1, 'run.started', { runId: 'r-1', threadId: 't-9' }),
        event(2, 'preview.ready', { previewId: 'pv-1', runId: 'r-1', url: 'http://x' }),
        event(3, 'preview.stopped', { previewId: 'pv-1', runId: 'r-1' }),
      ]);
      expect(state.previews).toHaveLength(1);
      expect(state.previews[0].status).toBe('stopped');
      expect(state.previews[0].threadId).toBe('t-9');
    });
  });

  describe('connection errors', () => {
    it('sets connection error from message', () => {
      const state = applyEvent(initialWorkbenchState, event(1, 'error', { message: 'boom' }));
      expect(state.connection.status).toBe('error');
      expect(state.connection.error).toBe('boom');
    });

    it('falls back to code then a default message', () => {
      const byCode = applyEvent(initialWorkbenchState, event(1, 'error', { code: 'E_X' }));
      expect(byCode.connection.error).toBe('E_X');
      const bare = applyEvent(initialWorkbenchState, event(1, 'error', {}));
      expect(bare.connection.error).toBe('Unknown Edge error');
    });
  });

  describe('immutability', () => {
    it('does not mutate the input state', () => {
      const before = initialWorkbenchState;
      const frozen = { ...before, projects: [...before.projects] };
      applyEvent(before, event(1, 'project.created', { projectId: 'p-1' }));
      expect(before.projects).toEqual(frozen.projects);
      expect(before.lastSeq).toBe(frozen.lastSeq);
    });
  });
});
