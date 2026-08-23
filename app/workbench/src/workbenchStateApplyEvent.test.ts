import { describe, expect, it } from 'vitest';
import type { AnyEvent } from '@shared/events';
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
      expect(log).toBeDefined();
      expect(log?.stdout).toBe('out-1out-2');
      expect(log?.stderr).toBe('err-1');
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
      expect(log).toBeDefined();
      expect(log?.stdout).toContain('a');
      expect(log?.stdout).toContain('[output truncated after 42 bytes]');
      expect(log?.stderr).toBe('b');
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
      // Reducer guarantees a non-empty fallback message; assert presence rather
      // than hardcoding the exact text (test must not duplicate source strings).
      expect(typeof bare.connection.error).toBe('string');
      expect(bare.connection.error).not.toBe('');
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

  describe('thread updates', () => {
    it('merges thread.updated fields into the existing thread', () => {
      const state = applyAll([
        event(1, 'thread.created', { threadId: 'th-1', projectId: 'p-1' }),
        event(2, 'thread.updated', {
          threadId: 'th-1',
          title: 'Renamed',
          status: 'archived',
          conversationId: 'conv-1',
        }),
      ]);
      expect(state.threads).toHaveLength(1);
      expect(state.threads[0]).toMatchObject({
        id: 'th-1',
        projectId: 'p-1',
        title: 'Renamed',
        status: 'archived',
        conversationId: 'conv-1',
      });
    });

    it('keeps the current thread status when the update carries an invalid one', () => {
      const state = applyAll([
        event(1, 'thread.created', { threadId: 'th-2' }),
        event(2, 'thread.updated', { threadId: 'th-2', status: 'banana' }),
      ]);
      expect(state.threads[0]?.status).toBe('active');
    });

    it('skips thread events without any resolvable id but still bumps seq', () => {
      const state = applyEvent(initialWorkbenchState, event(4, 'thread.updated', { title: 'x' }));
      expect(state.threads).toHaveLength(0);
      expect(state.lastSeq).toBe(4);
    });
  });

  describe('items and runners', () => {
    it('creates and updates thread items via item.created / item.updated', () => {
      const created = applyEvent(
        initialWorkbenchState,
        event(1, 'item.created', {
          itemId: 'item-1',
          threadId: 'th-1',
          kind: 'message',
          role: 'user',
          content: 'hello',
        }),
      );
      expect(created.threadItems[0]).toMatchObject({
        id: 'item-1',
        threadId: 'th-1',
        kind: 'message',
        role: 'user',
        content: 'hello',
        createdAt: sentAt,
      });

      // Partial update keeps prior kind/role when the payload omits them.
      const updated = applyEvent(
        created,
        event(2, 'item.updated', { itemId: 'item-1', threadId: 'th-1', content: 'edited' }),
      );
      expect(updated.threadItems).toHaveLength(1);
      expect(updated.threadItems[0]).toMatchObject({
        id: 'item-1',
        kind: 'message',
        role: 'user',
        content: 'edited',
      });
    });

    it('resolves the item threadId from scope when the payload omits it', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(1, 'item.created', { itemId: 'item-2', content: 'scoped' }, { threadId: 'th-scope' }),
      );
      expect(state.threadItems[0]?.threadId).toBe('th-scope');
    });

    it('bumps seq without adding an item when ids are missing', () => {
      const state = applyEvent(initialWorkbenchState, event(5, 'item.created', { content: 'no ids' }));
      expect(state.threadItems).toHaveLength(0);
      expect(state.lastSeq).toBe(5);
    });

    it('tracks runner.online and runner.offline, preserving known fields', () => {
      const online = applyEvent(
        initialWorkbenchState,
        event(1, 'runner.online', { runnerId: 'edge-1', name: 'Edge Runner', capabilities: 'shell' }),
      );
      expect(online.runners[0]).toMatchObject({
        id: 'edge-1',
        name: 'Edge Runner',
        status: 'online',
        capabilities: 'shell',
      });

      const offline = applyEvent(online, event(2, 'runner.offline', { runnerId: 'edge-1' }));
      expect(offline.runners).toHaveLength(1);
      expect(offline.runners[0]).toMatchObject({
        id: 'edge-1',
        name: 'Edge Runner',
        status: 'offline',
        capabilities: 'shell',
      });
    });

    it('ignores runner events without a runnerId', () => {
      const state = applyEvent(initialWorkbenchState, event(3, 'runner.online', { name: 'ghost' }));
      expect(state.runners).toHaveLength(0);
      expect(state.lastSeq).toBe(3);
    });
  });

  describe('missing-id guards keep collections intact but advance seq', () => {
    it('message.delta without messageId/threadId', () => {
      const state = applyEvent(initialWorkbenchState, event(1, 'message.delta', { delta: 'text' }));
      expect(state.threadItems).toHaveLength(0);
      expect(state.lastSeq).toBe(1);
    });

    it('run.output without runId', () => {
      const state = applyEvent(initialWorkbenchState, event(2, 'run.output', { text: 'log' }));
      expect(state.runLogs).toEqual({});
      expect(state.lastSeq).toBe(2);
    });

    it('run.output.batch resolves runId from scope and routes streams', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(
          3,
          'run.output.batch',
          { chunks: [{ text: 'out1' }, { text: 'err1', stream: 'stderr' }] },
          { runId: 'r-scope' },
        ),
      );
      expect(state.runLogs['r-scope']?.stdout).toBe('out1');
      expect(state.runLogs['r-scope']?.stderr).toBe('err1');
    });

    it('approval.requested requires approvalId, runId and threadId', () => {
      const missingThread = applyEvent(
        initialWorkbenchState,
        event(4, 'approval.requested', { approvalId: 'a-1', runId: 'r-1' }),
      );
      expect(missingThread.approvals).toHaveLength(0);
      expect(missingThread.runs).toHaveLength(0);
      expect(missingThread.lastSeq).toBe(4);
    });

    it('approval.decided without approvalId or for an unknown id changes nothing', () => {
      const noId = applyEvent(initialWorkbenchState, event(5, 'approval.decided', { decision: 'approved' }));
      expect(noId.approvals).toHaveLength(0);
      expect(noId.lastSeq).toBe(5);

      const seeded = applyEvent(
        initialWorkbenchState,
        event(6, 'approval.requested', {
          approvalId: 'a-2',
          runId: 'r-2',
          threadId: 'th-2',
          kind: 'command',
          summary: 'ok?',
        }),
      );
      const unknown = applyEvent(seeded, event(7, 'approval.decided', { approvalId: 'a-missing', decision: 'approved' }));
      expect(unknown.approvals[0]).toMatchObject({ id: 'a-2', status: 'pending' });
    });

    it('artifact.created requires artifactId, runId and threadId', () => {
      const state = applyEvent(
        initialWorkbenchState,
        event(8, 'artifact.created', { artifactId: 'art-x', runId: 'r-x' }),
      );
      expect(state.artifacts).toHaveLength(0);
      expect(state.lastSeq).toBe(8);
    });

    it('preview.ready and preview.stopped require previewId and runId', () => {
      const ready = applyEvent(initialWorkbenchState, event(9, 'preview.ready', { previewId: 'pv-x' }));
      expect(ready.previews).toHaveLength(0);
      expect(ready.lastSeq).toBe(9);

      const stopped = applyEvent(initialWorkbenchState, event(10, 'preview.stopped', { runId: 'r-x' }));
      expect(stopped.previews).toHaveLength(0);
      expect(stopped.lastSeq).toBe(10);
    });
  });
});
