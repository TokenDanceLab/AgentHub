// real_tested=true
import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope, EventScope } from '../events';
import { AGENT_AUTHOR } from './edgeEventEvidence';
import {
  agentResultBlock,
  childAgentBlock,
  compactBoundaryBlock,
  contextUsageBlock,
  routeDecisionBlock,
  subagentBlock,
  subtaskBlock,
} from './edgeEventMappersAgents';
import type {
  CompactBoundaryTranscriptBlock,
  ContextUsageTranscriptBlock,
  SubagentTranscriptBlock,
  SubtaskTranscriptBlock,
} from './types';

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

describe('subagentBlock', () => {
  it('maps primary payload fields into a subagent block with run evidence', () => {
    expect(
      subagentBlock(
        edgeEvent('evt-sub', 1, 'run.agent.subtask', {
          runId: 'run-1',
          taskRunId: 'task-1',
          title: 'Research',
          worker: 'w1',
          status: 'queued',
          summary: '  Done  ',
          agentId: 'agent-7',
          agentName: 'Researcher',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-sub',
      author: { id: 'agent-7', name: 'Researcher', role: 'agent' },
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'pending' },
      ],
      kind: 'subagent',
      title: 'Research',
      worker: 'w1',
      status: 'pending',
      summary: 'Done',
      runId: 'task-1',
    });
  });

  it('falls back to legacy field names for run id, title, worker, and summary', () => {
    const raw = subagentBlock(
      edgeEvent('evt-legacy', 2, 'run.agent.subtask', {
        runId: 'run-2',
        taskId: 'task-9',
        task: 'Survey',
        workerName: 'w2',
        content: '  partial  ',
        id: 'payload-5',
      }),
    );
    expect(raw).not.toBeNull();
    const block = raw as SubagentTranscriptBlock;
    expect(block.kind).toBe('subagent');
    expect(block.title).toBe('Survey');
    expect(block.worker).toBe('w2');
    expect(block.summary).toBe('partial');
    expect(block.runId).toBe('task-9');
    expect(block.status).toBe('running');
  });

  it('falls back through agent and agentName for the worker and name for the title', () => {
    expect(
      subagentBlock(
        edgeEvent('evt-a', 3, 'run.agent.subtask', { runId: 'run-3', title: 'T3', agent: 'agent-x', status: 'succeeded' }),
      ),
    ).toMatchObject({ kind: 'subagent', worker: 'agent-x', status: 'completed' });

    expect(
      subagentBlock(
        edgeEvent('evt-b', 4, 'run.agent.subtask', { runId: 'run-4', title: 'T4', agentName: 'a-9' }),
      ),
    ).toMatchObject({ kind: 'subagent', worker: 'a-9' });

    expect(
      subagentBlock(
        edgeEvent('evt-c', 5, 'run.agent.subtask', { runId: 'run-5', name: 'Named task', worker: 'w' }),
      ),
    ).toMatchObject({ kind: 'subagent', title: 'Named task' });
  });

  it('returns null when the title is missing', () => {
    expect(
      subagentBlock(edgeEvent('evt-t', 6, 'run.agent.subtask', { runId: 'run-6', worker: 'w' })),
    ).toBeNull();
  });

  it('returns null when the worker is missing', () => {
    expect(
      subagentBlock(edgeEvent('evt-w', 7, 'run.agent.subtask', { runId: 'run-7', title: 'T' })),
    ).toBeNull();
  });

  it('treats whitespace-only title and worker as missing', () => {
    expect(
      subagentBlock(
        edgeEvent('evt-ws', 8, 'run.agent.subtask', { runId: 'run-8', title: '   ', worker: '\t ' }),
      ),
    ).toBeNull();
  });

  it('omits the summary and runId keys when no summary-like or task id fields are present', () => {
    const raw = subagentBlock(
      edgeEvent('evt-ns', 9, 'run.agent.subtask', { runId: 'run-9', title: 'T', worker: 'W' }),
    );
    expect(raw).not.toBeNull();
    const block = raw as SubagentTranscriptBlock;
    expect(block.summary).toBeUndefined();
    expect(block.runId).toBeUndefined();
  });

  it('reads the run id from scope when the payload has none', () => {
    const raw = subagentBlock(
      edgeEvent('evt-sc', 10, 'run.agent.subtask', { title: 'T', worker: 'W' }, undefined, {
        runId: 'scope-run',
      }),
    );
    expect(raw).not.toBeNull();
    const block = raw as SubagentTranscriptBlock;
    expect(block.evidenceRefs).toEqual([
      { id: 'run-scope-run', kind: 'run', label: 'Run scope-run', status: 'running' },
    ]);
  });

  it('omits createdAt when the envelope has no sentAt', () => {
    const raw = subagentBlock(
      edgeEvent('evt-no-sent', 11, 'run.agent.subtask', { runId: 'run-11', title: 'T', worker: 'W' }, ''),
    );
    expect(raw).not.toBeNull();
    const block = raw as SubagentTranscriptBlock;
    expect(block.createdAt).toBeUndefined();
  });
});

describe('subtaskBlock', () => {
  it('maps primary fields into a subtask block', () => {
    expect(
      subtaskBlock(
        edgeEvent('evt-st', 1, 'run.agent.subtask', {
          runId: 'run-1',
          taskRunId: 'st-1',
          title: 'Do it',
          worker: 'W',
          status: 'running',
          summary: 'S',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-st',
      author: { id: 'w', name: 'W', role: 'agent' },
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
      ],
      kind: 'subtask',
      title: 'Do it',
      worker: 'W',
      status: 'running',
      summary: 'S',
      runId: 'st-1',
    });
  });

  it('produces a minimal block from a bare title without worker, summary, or evidence', () => {
    const raw = subtaskBlock(
      edgeEvent('evt-min', 2, 'run.agent.subtask', { title: 'Only title' }),
    );
    expect(raw).not.toBeNull();
    const block = raw as SubtaskTranscriptBlock;
    expect(block).toMatchObject({ kind: 'subtask', title: 'Only title', status: 'running' });
    expect(block.worker).toBeUndefined();
    expect(block.summary).toBeUndefined();
    expect(block.runId).toBeUndefined();
    expect(block.evidenceRefs).toBeUndefined();
  });

  it('maps edge-server task shapes via description and agentName', () => {
    expect(
      subtaskBlock(
        edgeEvent('evt-edge', 3, 'run.agent.subtask', {
          runId: 'run-3',
          description: 'Do the thing',
          agentName: 'bot-1',
          status: 'streaming',
        }),
      ),
    ).toMatchObject({
      kind: 'subtask',
      title: 'Do the thing',
      worker: 'bot-1',
      status: 'running',
    });
  });

  it('falls back to content for the summary', () => {
    expect(
      subtaskBlock(
        edgeEvent('evt-c', 4, 'run.agent.subtask', { runId: 'run-4', title: 'T', content: '  body  ' }),
      ),
    ).toMatchObject({ kind: 'subtask', title: 'T', summary: 'body' });
  });

  it('falls back to name/progress titles and agentId run ids', () => {
    expect(
      subtaskBlock(
        edgeEvent('evt-n', 5, 'run.agent.subtask', { runId: 'run-5', name: 'Named', agentId: 'ag-2' }),
      ),
    ).toMatchObject({ kind: 'subtask', title: 'Named', runId: 'ag-2' });

    expect(
      subtaskBlock(
        edgeEvent('evt-p', 6, 'run.agent.subtask', { runId: 'run-6', progress: 'In progress', agentName: 'b2' }),
      ),
    ).toMatchObject({ kind: 'subtask', title: 'In progress', worker: 'b2' });
  });

  it('returns null when no title-like field is present', () => {
    expect(
      subtaskBlock(edgeEvent('evt-none', 7, 'run.agent.subtask', { runId: 'run-7', worker: 'W' })),
    ).toBeNull();
  });
});

describe('childAgentBlock', () => {
  it('maps primary fields into a child agent block', () => {
    expect(
      childAgentBlock(
        edgeEvent('evt-ca', 1, 'run.agent.child', {
          runId: 'run-1',
          childRunId: 'c-1',
          parentRunId: 'p-1',
          title: 'Child',
          agent: 'a-1',
          status: 'completed',
          summary: 'ok',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-ca',
      author: { id: 'a-1', name: 'a-1', role: 'agent' },
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'completed' },
      ],
      kind: 'child_agent',
      title: 'Child',
      agent: 'a-1',
      status: 'completed',
      summary: 'ok',
      runId: 'c-1',
      parentRunId: 'p-1',
    });
  });

  it('falls back to childId, task, agentName, error summary, and the parent run id', () => {
    expect(
      childAgentBlock(
        edgeEvent('evt-ca2', 2, 'run.agent.child', {
          runId: 'run-2',
          childId: 'c-2',
          task: 'Fallback task',
          agentName: 'a-2',
          error: 'oops',
        }),
      ),
    ).toMatchObject({
      kind: 'child_agent',
      title: 'Fallback task',
      agent: 'a-2',
      summary: 'oops',
      runId: 'c-2',
      parentRunId: 'run-2',
      status: 'running',
    });
  });

  it('returns null without a title', () => {
    expect(
      childAgentBlock(edgeEvent('evt-ca3', 3, 'run.agent.child', { runId: 'run-3', agent: 'a' })),
    ).toBeNull();
  });

  it('returns null without an agent', () => {
    expect(
      childAgentBlock(edgeEvent('evt-ca4', 4, 'run.agent.child', { runId: 'run-4', title: 'T' })),
    ).toBeNull();
  });
});

describe('routeDecisionBlock', () => {
  it('maps action, summary, and targetAgent', () => {
    expect(
      routeDecisionBlock(
        edgeEvent('evt-rd', 1, 'run.agent.route_decision', {
          runId: 'run-1',
          action: 'route',
          summary: 'Route summary',
          targetAgent: 'next',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-rd',
      author: AGENT_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
      ],
      kind: 'route_decision',
      action: 'route',
      summary: 'Route summary',
      targetAgent: 'next',
    });
  });

  it('falls back to kind, instructions, and nextWorker', () => {
    expect(
      routeDecisionBlock(
        edgeEvent('evt-rd2', 2, 'run.agent.route_decision', {
          runId: 'run-2',
          kind: 'approve',
          instructions: 'do it',
          nextWorker: 'w-9',
        }),
      ),
    ).toMatchObject({
      kind: 'route_decision',
      action: 'approve',
      summary: 'do it',
      targetAgent: 'w-9',
    });
  });

  it('falls back to reasoning for the summary', () => {
    expect(
      routeDecisionBlock(
        edgeEvent('evt-rd3', 3, 'run.agent.route_decision', {
          runId: 'run-3',
          action: 'escalate',
          reasoning: 'because',
        }),
      ),
    ).toMatchObject({ kind: 'route_decision', action: 'escalate', summary: 'because' });
  });

  it('returns null when neither action nor kind is present', () => {
    expect(
      routeDecisionBlock(
        edgeEvent('evt-rd4', 4, 'run.agent.route_decision', { runId: 'run-4', summary: 'no action' }),
      ),
    ).toBeNull();
  });
});

describe('contextUsageBlock', () => {
  it('maps all primary fields and formats a numeric cost', () => {
    expect(
      contextUsageBlock(
        edgeEvent('evt-cu', 1, 'run.agent.context_usage', {
          runId: 'run-1',
          inputTokens: 1000,
          outputTokens: 500,
          contextLimit: 6000,
          totalTokens: 1500,
          usagePercent: 25,
          cachePercent: 10,
          cost: 0.42,
          modelLabel: 'gpt-5',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-cu',
      author: AGENT_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
      ],
      kind: 'context_usage',
      inputTokens: 1000,
      outputTokens: 500,
      usagePercent: 25,
      contextLimit: 6000,
      cachePercent: 10,
      cost: '$0.42',
      modelLabel: 'gpt-5',
    });
  });

  it('computes usagePercent from totals when not provided', () => {
    const raw = contextUsageBlock(
      edgeEvent('evt-cu2', 2, 'run.agent.context_usage', {
        runId: 'run-2',
        inputTokens: 100,
        outputTokens: 50,
        contextLimit: 300,
      }),
    );
    expect(raw).not.toBeNull();
    const block = raw as ContextUsageTranscriptBlock;
    expect(block.usagePercent).toBeCloseTo(50);
    expect(block.cost).toBeUndefined();
    expect(block.cachePercent).toBeUndefined();
  });

  it('falls back to short field names and coerces numeric strings', () => {
    const raw = contextUsageBlock(
      edgeEvent('evt-cu3', 3, 'run.agent.context_usage', {
        runId: 'run-3',
        input: '200',
        output: '100',
        limit: 1000,
        total: 300,
        cacheHitPercent: 5,
        totalCost: 1.5,
        provider: 'anthropic',
      }),
    );
    expect(raw).not.toBeNull();
    const block = raw as ContextUsageTranscriptBlock;
    expect(block.inputTokens).toBe(200);
    expect(block.outputTokens).toBe(100);
    expect(block.contextLimit).toBe(1000);
    expect(block.usagePercent).toBeCloseTo(30);
    expect(block.cachePercent).toBe(5);
    expect(block.cost).toBe('$1.50');
    expect(block.modelLabel).toBe('anthropic');
  });

  it('defaults missing output tokens to zero and skips usagePercent without a limit', () => {
    const raw = contextUsageBlock(
      edgeEvent('evt-cu4', 4, 'run.agent.context_usage', { runId: 'run-4', inputTokens: 10 }),
    );
    expect(raw).not.toBeNull();
    const block = raw as ContextUsageTranscriptBlock;
    expect(block.inputTokens).toBe(10);
    expect(block.outputTokens).toBe(0);
    expect(block.usagePercent).toBeUndefined();
  });

  it('accepts a zero token count as present', () => {
    const raw = contextUsageBlock(
      edgeEvent('evt-cu5', 5, 'run.agent.context_usage', { runId: 'run-5', inputTokens: 0 }),
    );
    expect(raw).not.toBeNull();
    const block = raw as ContextUsageTranscriptBlock;
    expect(block.inputTokens).toBe(0);
    expect(block.outputTokens).toBe(0);
  });

  it('keeps string costs verbatim', () => {
    expect(
      contextUsageBlock(
        edgeEvent('evt-cu6', 6, 'run.agent.context_usage', { runId: 'run-6', inputTokens: 1, cost: 'free tier' }),
      ),
    ).toMatchObject({ kind: 'context_usage', cost: 'free tier' });
  });

  it('returns null when no token counts are present or they are not finite', () => {
    expect(
      contextUsageBlock(
        edgeEvent('evt-cu7', 7, 'run.agent.context_usage', { runId: 'run-7', modelLabel: 'x' }),
      ),
    ).toBeNull();
    expect(
      contextUsageBlock(
        edgeEvent('evt-cu8', 8, 'run.agent.context_usage', {
          runId: 'run-8',
          inputTokens: Number.NaN,
          outputTokens: Number.NaN,
        }),
      ),
    ).toBeNull();
  });
});

describe('agentResultBlock', () => {
  it('maps a successful result with summary, duration, and turns', () => {
    expect(
      agentResultBlock(
        edgeEvent('evt-res', 1, 'run.agent.result', {
          runId: 'run-1',
          success: true,
          summary: 'All good',
          duration: '3s',
          turns: 4,
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-res',
      author: AGENT_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'completed' },
      ],
      kind: 'result',
      success: true,
      summary: 'All good',
      duration: '3s',
      turns: 4,
    });
  });

  it('generates a default summary for a bare success', () => {
    expect(
      agentResultBlock(edgeEvent('evt-res2', 2, 'run.agent.result', { runId: 'run-2', success: true })),
    ).toMatchObject({ kind: 'result', success: true, summary: 'Run run-2 result received' });
  });

  it('marks failure and appends the error to the default summary', () => {
    expect(
      agentResultBlock(
        edgeEvent('evt-res3', 3, 'run.agent.result', { runId: 'run-3', success: false, error: 'boom' }),
      ),
    ).toMatchObject({
      kind: 'result',
      success: false,
      summary: 'Run run-3 result failed: boom',
      evidenceRefs: [
        { id: 'run-run-3', kind: 'run', label: 'Run run-3', status: 'failed' },
      ],
    });
  });

  it('generates a default summary for a bare failure', () => {
    expect(
      agentResultBlock(edgeEvent('evt-res4', 4, 'run.agent.result', { runId: 'run-4', success: false })),
    ).toMatchObject({ kind: 'result', success: false, summary: 'Run run-4 result failed' });
  });

  it('falls back to content for the summary', () => {
    expect(
      agentResultBlock(
        edgeEvent('evt-res5', 5, 'run.agent.result', {
          runId: 'run-5',
          success: true,
          content: '  content result  ',
        }),
      ),
    ).toMatchObject({ kind: 'result', summary: 'content result' });
  });

  it('derives a duration label from durationMs', () => {
    expect(
      agentResultBlock(
        edgeEvent('evt-res6', 6, 'run.agent.result', { runId: 'run-6', success: true, durationMs: 65000 }),
      ),
    ).toMatchObject({ kind: 'result', duration: '1m5s' });
  });

  it('returns null and warns when the run id is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        agentResultBlock(edgeEvent('evt-res7', 7, 'run.agent.result', { success: true, summary: 'x' })),
      ).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        'normalizeEdgeEvents: run.agent.result missing runId',
        { eventId: 'evt-res7' },
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('compactBoundaryBlock', () => {
  it('maps trigger and preTokens', () => {
    expect(
      compactBoundaryBlock(
        edgeEvent('evt-cb', 1, 'run.agent.compact_boundary', { runId: 'run-1', trigger: 'auto', preTokens: 8000 }),
      ),
    ).toEqual({
      id: 'edge-event-evt-cb',
      author: AGENT_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
      ],
      kind: 'compact_boundary',
      trigger: 'auto',
      preTokens: 8000,
    });
  });

  it('falls back to pre_tokens', () => {
    const raw = compactBoundaryBlock(
      edgeEvent('evt-cb2', 2, 'run.agent.compact_boundary', { runId: 'run-2', pre_tokens: '4000' }),
    );
    expect(raw).toMatchObject({ kind: 'compact_boundary', preTokens: 4000 });
    const block = raw as CompactBoundaryTranscriptBlock;
    expect(block.trigger).toBeUndefined();
  });

  it('produces a minimal block from an empty payload', () => {
    expect(compactBoundaryBlock(edgeEvent('evt-cb3', 3, 'run.agent.compact_boundary', {}))).toEqual({
      id: 'edge-event-evt-cb3',
      author: AGENT_AUTHOR,
      createdAt: '2026-06-07T03:00:03Z',
      kind: 'compact_boundary',
    });
  });
});
