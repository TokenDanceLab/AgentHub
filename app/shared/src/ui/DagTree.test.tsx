import { describe, expect, it } from 'vitest';
import { buildDagNodesFromTranscript } from './DagTree';
import type { TranscriptBlock } from '../transcript';

describe('buildDagNodesFromTranscript', () => {
  it('keeps subtask orchestration blocks visible in the inspector DAG', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'subtask-review',
        kind: 'subtask',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'Review chat card contracts',
        worker: 'Reviewer',
        status: 'running',
      },
    ];

    expect(buildDagNodesFromTranscript(blocks)).toEqual([
      {
        id: 'subtask-review',
        label: 'Reviewer',
        status: 'in_progress',
        children: undefined,
      },
    ]);
  });

  it('uses the subtask title when the worker name has not arrived yet', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'subtask-pending-worker',
        kind: 'subtask',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: 'Audit chat ordering',
        status: 'pending',
      },
    ];

    expect(buildDagNodesFromTranscript(blocks)).toEqual([
      {
        id: 'subtask-pending-worker',
        label: 'Audit chat ordering',
        status: 'pending',
        children: undefined,
      },
    ]);
  });
});
