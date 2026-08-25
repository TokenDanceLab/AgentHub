// real_tested=true
import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope, EventScope } from '../events';
import { EDGE_AUTHOR } from './edgeEventEvidence';
import {
  agentTextBlock,
  outputBatchTextBlock,
  outputTextBlock,
  runCancelledBlock,
  runFailedBlock,
  runFinishedBlock,
  runStatusBlock,
  runTextBlock,
  thinkingBlock,
} from './edgeEventMappersRun';
import type {
  FailureTranscriptBlock,
  FinishedTranscriptBlock,
  ThinkingTranscriptBlock,
} from './types';

const STDIN_WARNING =
  'Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.';

function edgeEvent(
  id: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  sentAt = `2026-06-07T03:00:0${seq}Z`,
  scopeOverrides: EventScope = {},
): EventEnvelope {
  return {
    version: 'v1',
    id,
    seq,
    type,
    scope: {
      threadId: 'thread-live',
      runId: typeof payload.runId === 'string' ? payload.runId : undefined,
      ...scopeOverrides,
    },
    sentAt,
    payload,
  };
}

describe('runTextBlock', () => {
  it('builds a text block with the given action and status', () => {
    expect(
      runTextBlock(
        edgeEvent('evt-rt', 1, 'run.started', { runId: 'run-1', startedAt: '2026-06-07T03:00:01Z' }),
        'started',
        'running',
      ),
    ).toEqual({
      id: 'edge-event-evt-rt',
      author: EDGE_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
      ],
      kind: 'text',
      text: 'Run run-1 started',
    });
  });

  it('honours a custom status passed by the caller', () => {
    expect(
      runTextBlock(edgeEvent('evt-rt2', 2, 'run.queued', { runId: 'run-2' }), 'queued', 'pending'),
    ).toMatchObject({
      kind: 'text',
      text: 'Run run-2 queued',
      evidenceRefs: [
        { id: 'run-run-2', kind: 'run', label: 'Run run-2', status: 'pending' },
      ],
    });
  });

  it('returns null and warns when the run id is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(runTextBlock(edgeEvent('evt-rt3', 3, 'run.started', {}), 'started', 'running')).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        'normalizeEdgeEvents: run lifecycle event missing runId',
        { type: 'run.started', eventId: 'evt-rt3' },
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('runStatusBlock', () => {
  it('maps a status change into a text block with normalized evidence', () => {
    expect(
      runStatusBlock(
        edgeEvent('evt-rs', 1, 'run.status.changed', { runId: 'run-1', status: 'completed' }),
      ),
    ).toEqual({
      id: 'edge-event-evt-rs',
      author: EDGE_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'completed' },
      ],
      kind: 'text',
      text: 'Run run-1 completed',
    });
  });

  it('keeps unknown status text verbatim and normalizes evidence to running', () => {
    expect(
      runStatusBlock(
        edgeEvent('evt-rs2', 2, 'run.status.changed', { runId: 'run-2', status: 'throttled' }),
      ),
    ).toMatchObject({
      kind: 'text',
      text: 'Run run-2 throttled',
      evidenceRefs: [
        { id: 'run-run-2', kind: 'run', label: 'Run run-2', status: 'running' },
      ],
    });
  });

  it('returns null and warns when the run id is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        runStatusBlock(edgeEvent('evt-rs3', 3, 'run.status.changed', { status: 'running' })),
      ).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns null and warns when the status is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        runStatusBlock(edgeEvent('evt-rs4', 4, 'run.status.changed', { runId: 'run-4' })),
      ).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns null and warns when the status is whitespace-only', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        runStatusBlock(edgeEvent('evt-rs5', 5, 'run.status.changed', { runId: 'run-5', status: '   ' })),
      ).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('runFailedBlock', () => {
  it('maps a run failure with a reason', () => {
    expect(
      runFailedBlock(edgeEvent('evt-rf', 1, 'run.failed', { runId: 'run-1', reason: 'crashed' })),
    ).toEqual({
      id: 'edge-event-evt-rf',
      author: EDGE_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'failed' },
      ],
      kind: 'failure',
      title: 'Run run-1 failed',
      runId: 'run-1',
      reason: 'crashed',
    });
  });

  it('falls back to a string error for the reason', () => {
    expect(
      runFailedBlock(edgeEvent('evt-rf2', 2, 'run.failed', { runId: 'run-2', error: 'ERR-2' })),
    ).toMatchObject({ kind: 'failure', title: 'Run run-2 failed', reason: 'ERR-2' });
  });

  it('extracts the message from an error object payload', () => {
    expect(
      runFailedBlock(
        edgeEvent('evt-rf3', 3, 'run.failed', { runId: 'run-3', error: { message: 'inner failure' } }),
      ),
    ).toMatchObject({ kind: 'failure', reason: 'inner failure' });
  });

  it('falls back to a top-level message for the reason', () => {
    expect(
      runFailedBlock(edgeEvent('evt-rf4', 4, 'run.failed', { runId: 'run-4', message: 'plain message' })),
    ).toMatchObject({ kind: 'failure', reason: 'plain message' });
  });

  it('omits the reason key when no reason-like field is present', () => {
    const raw = runFailedBlock(edgeEvent('evt-rf5', 5, 'run.failed', { runId: 'run-5' }));
    expect(raw).not.toBeNull();
    const block = raw as FailureTranscriptBlock;
    expect(block.reason).toBeUndefined();
  });

  it('returns null and warns when the run id is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(runFailedBlock(edgeEvent('evt-rf6', 6, 'run.failed', { reason: 'x' }))).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('runCancelledBlock', () => {
  it('maps a run cancellation with a reason', () => {
    expect(
      runCancelledBlock(
        edgeEvent('evt-rc', 1, 'run.cancelled', { runId: 'run-1', reason: 'user aborted' }),
      ),
    ).toMatchObject({
      kind: 'failure',
      title: 'Run run-1 cancelled',
      runId: 'run-1',
      reason: 'user aborted',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'failed' },
      ],
    });
  });

  it('extracts the reason from an error object payload', () => {
    expect(
      runCancelledBlock(
        edgeEvent('evt-rc2', 2, 'run.cancelled', { runId: 'run-2', error: { reason: 'inner reason' } }),
      ),
    ).toMatchObject({ kind: 'failure', title: 'Run run-2 cancelled', reason: 'inner reason' });
  });

  it('returns null and warns when the run id is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(runCancelledBlock(edgeEvent('evt-rc3', 3, 'run.cancelled', { reason: 'x' }))).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('runFinishedBlock', () => {
  it('maps a finished run with a duration string', () => {
    expect(
      runFinishedBlock(edgeEvent('evt-fin', 1, 'run.finished', { runId: 'run-1', duration: '10s' })),
    ).toEqual({
      id: 'edge-event-evt-fin',
      author: EDGE_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'completed' },
      ],
      kind: 'finished',
      title: 'Run run-1 finished',
      runId: 'run-1',
      duration: '10s',
    });
  });

  it('derives a duration label from durationMs', () => {
    expect(
      runFinishedBlock(edgeEvent('evt-fin2', 2, 'run.finished', { runId: 'run-2', durationMs: 1500 })),
    ).toMatchObject({ kind: 'finished', title: 'Run run-2 finished', duration: '1.5s' });
  });

  it('omits the duration key when neither duration field is present', () => {
    const raw = runFinishedBlock(edgeEvent('evt-fin3', 3, 'run.finished', { runId: 'run-3' }));
    expect(raw).not.toBeNull();
    const block = raw as FinishedTranscriptBlock;
    expect(block.duration).toBeUndefined();
  });

  it('returns null and warns when the run id is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(runFinishedBlock(edgeEvent('evt-fin4', 4, 'run.finished', { duration: '1s' }))).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('outputTextBlock', () => {
  it('trims and maps run output text', () => {
    expect(
      outputTextBlock(
        edgeEvent('evt-out', 1, 'run.output', { runId: 'run-1', stream: 'stdout', text: '  hello  ' }),
      ),
    ).toEqual({
      id: 'edge-event-evt-out',
      author: EDGE_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
      ],
      kind: 'text',
      text: 'hello',
    });
  });

  it('falls back to the event id for evidence when the run id is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        outputTextBlock(edgeEvent('evt-fb', 2, 'run.output', { text: 'orphan output' })),
      ).toMatchObject({
        kind: 'text',
        text: 'orphan output',
        evidenceRefs: [
          { id: 'run-evt-fb', kind: 'run', label: 'Run evt-fb', status: 'running' },
        ],
      });
      expect(warnSpy).toHaveBeenCalledWith(
        'normalizeEdgeEvents: run.output missing runId, using event.id as fallback evidenceRef',
        { eventId: 'evt-fb' },
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns null when no text is present', () => {
    expect(outputTextBlock(edgeEvent('evt-out3', 3, 'run.output', { runId: 'run-3' }))).toBeNull();
  });

  it('returns null for whitespace-only text', () => {
    expect(
      outputTextBlock(edgeEvent('evt-out4', 4, 'run.output', { runId: 'run-4', text: '   ' })),
    ).toBeNull();
  });

  it('returns null for runtime diagnostic text', () => {
    expect(
      outputTextBlock(
        edgeEvent('evt-out5', 5, 'run.output', { runId: 'run-5', stream: 'stderr', text: STDIN_WARNING }),
      ),
    ).toBeNull();
  });
});

describe('outputBatchTextBlock', () => {
  it('joins chunk texts into one text block', () => {
    const raw = outputBatchTextBlock(
      edgeEvent('evt-ob', 1, 'run.output.batch', {
        runId: 'run-1',
        chunks: [{ offset: 0, text: 'a' }, { offset: 1, text: 'b' }],
      }),
    );
    expect(raw).toMatchObject({ kind: 'text', text: 'ab' });
    expect(raw?.author).toEqual(EDGE_AUTHOR);
  });

  it('skips non-record chunks', () => {
    expect(
      outputBatchTextBlock(
        edgeEvent('evt-ob2', 2, 'run.output.batch', {
          runId: 'run-2',
          chunks: ['junk', { text: 'x' }, null, 42, { other: 'y' }],
        }),
      ),
    ).toMatchObject({ kind: 'text', text: 'x' });
  });

  it('returns null when chunks is not an array', () => {
    expect(
      outputBatchTextBlock(edgeEvent('evt-ob3', 3, 'run.output.batch', { runId: 'run-3', chunks: 'oops' })),
    ).toBeNull();
  });

  it('returns null when the joined text is empty', () => {
    expect(
      outputBatchTextBlock(
        edgeEvent('evt-ob4', 4, 'run.output.batch', {
          runId: 'run-4',
          chunks: [{ text: '   ' }, { text: '' }],
        }),
      ),
    ).toBeNull();
  });

  it('returns null when the joined text is a runtime diagnostic', () => {
    expect(
      outputBatchTextBlock(
        edgeEvent('evt-ob5', 5, 'run.output.batch', {
          runId: 'run-5',
          chunks: [
            { text: 'Warning: no stdin data received in 3s, ' },
            { text: 'proceeding without it.' },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('falls back to the event id for evidence when the run id is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        outputBatchTextBlock(
          edgeEvent('evt-ob6', 6, 'run.output.batch', { chunks: [{ text: 'batch orphan' }] }),
        ),
      ).toMatchObject({
        kind: 'text',
        text: 'batch orphan',
        evidenceRefs: [
          { id: 'run-evt-ob6', kind: 'run', label: 'Run evt-ob6', status: 'running' },
        ],
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('agentTextBlock', () => {
  it('maps content into a text block with the default agent author', () => {
    expect(
      agentTextBlock(
        edgeEvent('evt-at', 1, 'run.agent.text_block', { runId: 'run-1', content: '  hi  ' }),
      ),
    ).toEqual({
      id: 'edge-event-evt-at',
      author: { id: 'agent', name: 'Agent', role: 'agent' },
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
      ],
      kind: 'text',
      text: 'hi',
    });
  });

  it('falls back to the text field for content', () => {
    expect(
      agentTextBlock(
        edgeEvent('evt-at2', 2, 'run.agent.text_block', { runId: 'run-2', text: 'fallback text' }),
      ),
    ).toMatchObject({ kind: 'text', text: 'fallback text' });
  });

  it('returns null for empty content', () => {
    expect(
      agentTextBlock(edgeEvent('evt-at3', 3, 'run.agent.text_block', { runId: 'run-3', content: '' })),
    ).toBeNull();
  });

  it('returns null for runtime diagnostic content', () => {
    expect(
      agentTextBlock(
        edgeEvent('evt-at4', 4, 'run.agent.text_block', { runId: 'run-4', content: STDIN_WARNING }),
      ),
    ).toBeNull();
  });

  it('derives the author from payload agent identity fields', () => {
    expect(
      agentTextBlock(
        edgeEvent('evt-at5', 5, 'run.agent.text_block', {
          runId: 'run-5',
          content: 'msg',
          agentId: 'ag-1',
          agentName: 'Nova',
        }),
      ),
    ).toMatchObject({
      kind: 'text',
      author: { id: 'ag-1', name: 'Nova', role: 'agent' },
    });
  });

  it('falls back to the event id for evidence when the run id is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        agentTextBlock(edgeEvent('evt-at6', 6, 'run.agent.text_block', { content: 'no run' })),
      ).toMatchObject({
        kind: 'text',
        text: 'no run',
        evidenceRefs: [
          { id: 'run-evt-at6', kind: 'run', label: 'Run evt-at6', status: 'running' },
        ],
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('thinkingBlock', () => {
  it('maps thinking content with a default running status', () => {
    expect(
      thinkingBlock(edgeEvent('evt-th', 1, 'run.agent.thinking', { runId: 'run-1', content: 'hmm' })),
    ).toEqual({
      id: 'edge-event-evt-th',
      author: { id: 'agent', name: 'Agent', role: 'agent' },
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
      ],
      kind: 'thinking',
      content: 'hmm',
      isThinking: true,
    });
  });

  it('flags completed thinking as no longer active', () => {
    const raw = thinkingBlock(
      edgeEvent('evt-th2', 2, 'run.agent.thinking', { runId: 'run-2', content: 'done', status: 'completed' }),
    );
    expect(raw).not.toBeNull();
    const block = raw as ThinkingTranscriptBlock;
    expect(block.isThinking).toBe(false);
    expect(block.evidenceRefs).toEqual([
      { id: 'run-run-2', kind: 'run', label: 'Run run-2', status: 'completed' },
    ]);
  });

  it('normalizes failure statuses', () => {
    const raw = thinkingBlock(
      edgeEvent('evt-th3', 3, 'run.agent.thinking', { runId: 'run-3', content: 'x', status: 'failed' }),
    );
    expect(raw).not.toBeNull();
    const block = raw as ThinkingTranscriptBlock;
    expect(block.isThinking).toBe(false);
    expect(block.evidenceRefs).toEqual([
      { id: 'run-run-3', kind: 'run', label: 'Run run-3', status: 'failed' },
    ]);
  });

  it('returns null when the content is empty', () => {
    expect(thinkingBlock(edgeEvent('evt-th4', 4, 'run.agent.thinking', { runId: 'run-4' }))).toBeNull();
    expect(
      thinkingBlock(edgeEvent('evt-th5', 5, 'run.agent.thinking', { runId: 'run-5', content: '   ' })),
    ).toBeNull();
  });

  it('omits evidence when there is no run id', () => {
    const raw = thinkingBlock(
      edgeEvent('evt-th6', 6, 'run.agent.thinking', { content: 'scope-less' }),
    );
    expect(raw).not.toBeNull();
    const block = raw as ThinkingTranscriptBlock;
    expect(block.evidenceRefs).toBeUndefined();
    expect(block.isThinking).toBe(true);
  });

  it('maps queued status to pending and flags thinking as inactive', () => {
    const raw = thinkingBlock(
      edgeEvent('evt-th7', 7, 'run.agent.thinking', { runId: 'run-7', content: 'y', status: 'queued' }),
    );
    expect(raw).not.toBeNull();
    const block = raw as ThinkingTranscriptBlock;
    expect(block.isThinking).toBe(false);
    expect(block.evidenceRefs).toEqual([
      { id: 'run-run-7', kind: 'run', label: 'Run run-7', status: 'pending' },
    ]);
  });
});

describe('run workDir evidence pass-through (#1967)', () => {
  it('run.started carries the executor-reported workDir into the run evidence ref', () => {
    const block = runTextBlock(
      edgeEvent('evt-wd-start', 1, 'run.started', {
        runId: 'run-wd',
        startedAt: '2026-06-07T03:00:01Z',
        workDir: '/tmp/ws-run-wd',
      }),
      'started',
      'running',
    );
    expect(block?.evidenceRefs?.[0]?.workDir).toBe('/tmp/ws-run-wd');
  });

  it('run.finished keeps the trusted workDir evidence', () => {
    const block = runFinishedBlock(
      edgeEvent('evt-wd-end', 2, 'run.finished', { runId: 'run-wd', workDir: '/tmp/ws-run-wd' }),
    );
    expect(block?.evidenceRefs?.[0]?.workDir).toBe('/tmp/ws-run-wd');
  });

  it('output batches keep the workDir attached to the running run ref', () => {
    const block = outputBatchTextBlock(
      edgeEvent('evt-wd-out', 3, 'run.output.batch', {
        runId: 'run-wd',
        workDir: '/tmp/ws-run-wd',
        chunks: [{ text: 'hello' }],
      }),
    );
    expect(block?.evidenceRefs?.[0]?.workDir).toBe('/tmp/ws-run-wd');
  });

  it('omits workDir on evidence refs when the executor reported none', () => {
    const block = runTextBlock(
      edgeEvent('evt-wd-none', 4, 'run.started', { runId: 'run-nowd', startedAt: '2026-06-07T03:00:04Z' }),
      'started',
      'running',
    );
    expect(block?.evidenceRefs?.[0]).toEqual({
      id: 'run-run-nowd',
      kind: 'run',
      label: 'Run run-nowd',
      status: 'running',
    });
  });
});
