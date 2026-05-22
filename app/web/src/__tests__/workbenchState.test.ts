import { describe, expect, it } from 'vitest';
import { createWorkbenchState, reduceWorkbenchEvent } from '@/state/workbenchState';
import type { EventEnvelope } from '@shared/events';

describe('workbenchState reducer', () => {
  it('deduplicates event ids while keeping the latest numeric cursor', () => {
    const event: EventEnvelope = {
      version: 'v1',
      id: 'evt_1',
      seq: 3,
      type: 'run.started',
      scope: { runId: 'run_1' },
      sentAt: '2026-05-22T12:00:00Z',
      payload: { runId: 'run_1', status: 'started' },
    };

    const once = reduceWorkbenchEvent(createWorkbenchState(), event);
    const twice = reduceWorkbenchEvent(once, event);

    expect(twice.events).toHaveLength(1);
    expect(twice.lastSeq).toBe(3);
    expect(twice.runsById.run_1?.status).toBe('running');
  });

  it('folds output batches by stream and offset for replay-safe logs', () => {
    const event: EventEnvelope = {
      version: 'v1',
      id: 'evt_2',
      seq: 4,
      type: 'run.output.batch',
      scope: { runId: 'run_1' },
      sentAt: '2026-05-22T12:00:01Z',
      payload: {
        runId: 'run_1',
        stream: 'stdout',
        chunks: [
          { offset: 0, text: 'Initializing mock runner...\n' },
          { offset: 29, text: 'Executing mock task step 1/3...\n' },
        ],
      },
    };

    const next = reduceWorkbenchEvent(createWorkbenchState(), event);
    const stdout = next.outputByRunId.run_1?.stdout;

    expect(stdout).toEqual([
      { offset: 0, text: 'Initializing mock runner...\n' },
      { offset: 29, text: 'Executing mock task step 1/3...\n' },
    ]);
  });

  it('indexes project, thread and item events without requiring component-owned URL state', () => {
    const base = createWorkbenchState();
    const withProject = reduceWorkbenchEvent(base, {
      version: 'v1',
      id: 'evt_project_1',
      seq: 1,
      type: 'project.created',
      scope: { projectId: 'proj_1' },
      sentAt: '2026-05-22T12:00:00Z',
      payload: { name: 'AgentHub', path: 'workspace' },
    });
    const withThread = reduceWorkbenchEvent(withProject, {
      version: 'v1',
      id: 'evt_thread_1',
      seq: 2,
      type: 'thread.created',
      scope: { projectId: 'proj_1', threadId: 'thread_1' },
      sentAt: '2026-05-22T12:00:01Z',
      payload: { title: 'Web UI integration', status: 'active' },
    });
    const withItem = reduceWorkbenchEvent(withThread, {
      version: 'v1',
      id: 'evt_item_1',
      seq: 3,
      type: 'item.created',
      scope: { threadId: 'thread_1', runId: 'run_1' },
      sentAt: '2026-05-22T12:00:02Z',
      payload: { itemId: 'item_1', type: 'run', status: 'created' },
    });

    expect(withItem.projectsById.proj_1).toMatchObject({
      projectId: 'proj_1',
      name: 'AgentHub',
      path: 'workspace',
    });
    expect(withItem.threadsById.thread_1).toMatchObject({
      threadId: 'thread_1',
      projectId: 'proj_1',
      title: 'Web UI integration',
      status: 'active',
    });
    expect(withItem.itemsById.item_1).toMatchObject({
      itemId: 'item_1',
      threadId: 'thread_1',
      runId: 'run_1',
      type: 'run',
      status: 'created',
    });
  });

  it('folds run status changes and preserves thread ownership from scope', () => {
    const queued: EventEnvelope = {
      version: 'v1',
      id: 'evt_run_queued',
      seq: 10,
      type: 'run.queued',
      scope: { threadId: 'thread_1', runId: 'run_1' },
      sentAt: '2026-05-22T12:00:03Z',
      payload: { status: 'queued', createdAt: '2026-05-22T12:00:03Z' },
    };
    const running: EventEnvelope = {
      version: 'v1',
      id: 'evt_run_status',
      seq: 11,
      type: 'run.status.changed',
      scope: { runId: 'run_1' },
      sentAt: '2026-05-22T12:00:04Z',
      payload: { status: 'running' },
    };

    const next = reduceWorkbenchEvent(reduceWorkbenchEvent(createWorkbenchState(), queued), running);

    expect(next.runsById.run_1).toMatchObject({
      runId: 'run_1',
      threadId: 'thread_1',
      status: 'running',
      createdAt: '2026-05-22T12:00:03Z',
    });
    expect(next.lastSeq).toBe(11);
  });
});
