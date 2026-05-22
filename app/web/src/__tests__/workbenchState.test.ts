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
});
