// real_tested=true
import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope, EventScope } from '../events';
import { AGENT_AUTHOR } from './edgeEventEvidence';
import {
  fileChangeBlock,
  toolCallBlock,
  toolResultBlock,
} from './edgeEventMappersTools';

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

describe('toolCallBlock', () => {
  it('builds a tool_call block from toolName/callId/status/target/summary', () => {
    expect(
      toolCallBlock(
        edgeEvent('evt-tc', 1, 'run.agent.tool_call', {
          runId: 'run-1',
          toolName: 'rg',
          callId: 'call-1',
          status: 'completed',
          target: 'app/shared/src',
          summary: 'search for usage',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-tc',
      author: AGENT_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'completed' },
        { id: 'tool-call-1', kind: 'tool', label: 'rg', status: 'completed' },
      ],
      kind: 'tool_call',
      callId: 'call-1',
      toolName: 'rg',
      status: 'completed',
      target: 'app/shared/src',
      summary: 'search for usage',
    });
  });

  it('falls back to payload.name and payload.id for tool name and call id', () => {
    const block = toolCallBlock(
      edgeEvent('evt-tc2', 2, 'run.agent.tool_call', {
        runId: 'run-2',
        name: 'git',
        id: 'call-9',
      }),
    );
    expect(block).toMatchObject({
      kind: 'tool_call',
      callId: 'call-9',
      toolName: 'git',
      evidenceRefs: [
        { id: 'run-run-2', kind: 'run', label: 'Run run-2', status: 'running' },
        { id: 'tool-call-9', kind: 'tool', label: 'git', status: 'running' },
      ],
    });
  });

  it('defaults the status to running when missing and normalizes streaming', () => {
    const withoutStatus = toolCallBlock(
      edgeEvent('evt-tc3', 3, 'run.agent.tool_call', { toolName: 'rg', callId: 'c3' }),
    );
    expect(withoutStatus?.status).toBe('running');

    const streaming = toolCallBlock(
      edgeEvent('evt-tc4', 4, 'run.agent.tool_call', {
        toolName: 'rg',
        callId: 'c4',
        status: 'streaming',
      }),
    );
    expect(streaming?.status).toBe('running');
  });

  it('normalizes a queued status to pending', () => {
    const queued = toolCallBlock(
      edgeEvent('evt-tc4b', 5, 'run.agent.tool_call', {
        toolName: 'rg',
        callId: 'c4b',
        status: 'queued',
      }),
    );
    expect(queued?.status).toBe('pending');
  });

  it('prefers summary, then description, then reason for the summary field', () => {
    const withSummary = toolCallBlock(
      edgeEvent('evt-tc5', 5, 'run.agent.tool_call', {
        toolName: 'rg',
        summary: 'explicit summary',
        description: 'long description',
        reason: 'why',
      }),
    );
    expect(withSummary?.summary).toBe('explicit summary');

    const withDescription = toolCallBlock(
      edgeEvent('evt-tc6', 6, 'run.agent.tool_call', {
        toolName: 'rg',
        description: '  long description  ',
        reason: 'why',
      }),
    );
    expect(withDescription?.summary).toBe('long description');

    const withReason = toolCallBlock(
      edgeEvent('evt-tc7', 7, 'run.agent.tool_call', {
        toolName: 'rg',
        reason: 'why',
      }),
    );
    expect(withReason?.summary).toBe('why');
  });

  it('falls back to path, command, then query for the target field', () => {
    const withPath = toolCallBlock(
      edgeEvent('evt-tc8', 8, 'run.agent.tool_call', { toolName: 'rg', path: 'app/shared' }),
    );
    expect(withPath?.target).toBe('app/shared');

    const withCommand = toolCallBlock(
      edgeEvent('evt-tc9', 9, 'run.agent.tool_call', { toolName: 'rg', command: 'git status' }),
    );
    expect(withCommand?.target).toBe('git status');

    const withQuery = toolCallBlock(
      edgeEvent('evt-tc10', 1, 'run.agent.tool_call', { toolName: 'rg', query: 'FROM users' }),
    );
    expect(withQuery?.target).toBe('FROM users');
  });

  it('omits target and summary keys when neither is present', () => {
    const block = toolCallBlock(
      edgeEvent('evt-tc11', 2, 'run.agent.tool_call', { toolName: 'rg', callId: 'c11' }),
    );
    expect(block).not.toHaveProperty('target');
    expect(block).not.toHaveProperty('summary');
  });

  it('derives the author from payload agent id and name', () => {
    const block = toolCallBlock(
      edgeEvent('evt-tc12', 3, 'run.agent.tool_call', {
        toolName: 'rg',
        agentId: 'agent-a',
        agentName: 'Alpha',
      }),
    );
    expect(block?.author).toEqual({ id: 'agent-a', name: 'Alpha', role: 'agent' });
  });

  it('returns null and warns when both toolName and callId are missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        toolCallBlock(edgeEvent('evt-tc13', 4, 'run.agent.tool_call', { summary: 'no ids' })),
      ).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        'normalizeEdgeEvents: tool_call missing both toolName and callId',
        { eventId: 'evt-tc13' },
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('toolResultBlock', () => {
  it('builds a tool_result block with content as the summary', () => {
    expect(
      toolResultBlock(
        edgeEvent('evt-tr', 1, 'run.agent.tool_result', {
          runId: 'run-1',
          toolName: 'rg',
          callId: 'call-1',
          content: '3 matches',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-tr',
      author: AGENT_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'completed' },
        { id: 'tool-call-1', kind: 'tool', label: 'rg result', status: 'completed' },
      ],
      kind: 'tool_result',
      callId: 'call-1',
      toolName: 'rg',
      status: 'completed',
      summary: '3 matches',
    });
  });

  it('marks the result as failed when isError is true', () => {
    const block = toolResultBlock(
      edgeEvent('evt-tr2', 2, 'run.agent.tool_result', {
        toolName: 'rg',
        callId: 'call-2',
        isError: true,
        content: 'boom',
      }),
    );
    expect(block?.status).toBe('failed');
    expect(block?.evidenceRefs?.[0]?.status).toBe('failed');
  });

  it('marks the result as failed when an error string is present without isError', () => {
    const block = toolResultBlock(
      edgeEvent('evt-tr3', 3, 'run.agent.tool_result', {
        toolName: 'rg',
        callId: 'call-3',
        error: 'permission denied',
      }),
    );
    expect(block?.status).toBe('failed');
    expect(block?.summary).toBe('permission denied');
  });

  it('falls back to payload.name for the tool name', () => {
    const block = toolResultBlock(
      edgeEvent('evt-tr4', 4, 'run.agent.tool_result', {
        name: 'git',
        callId: 'call-4',
      }),
    );
    expect(block?.toolName).toBe('git');
  });

  it('uses the callId as the tool name when only callId is present', () => {
    const block = toolResultBlock(
      edgeEvent('evt-tr5', 5, 'run.agent.tool_result', { callId: 'call-5', content: 'ok' }),
    );
    expect(block?.toolName).toBe('call-5');
    expect(block?.callId).toBe('call-5');
    expect(block?.evidenceRefs?.[0]?.label).toBe('call-5 result');
  });

  it('returns null when toolName, name, and callId are all missing', () => {
    expect(
      toolResultBlock(edgeEvent('evt-tr6', 6, 'run.agent.tool_result', { content: 'no ids' })),
    ).toBeNull();
  });

  it('prefers summary, then content, then error for the summary field', () => {
    const withSummary = toolResultBlock(
      edgeEvent('evt-tr7', 7, 'run.agent.tool_result', {
        toolName: 'rg',
        summary: 'explicit',
        content: 'content text',
      }),
    );
    expect(withSummary?.summary).toBe('explicit');

    const withContent = toolResultBlock(
      edgeEvent('evt-tr8', 8, 'run.agent.tool_result', {
        toolName: 'rg',
        content: 'content text',
      }),
    );
    expect(withContent?.summary).toBe('content text');
  });
});

describe('fileChangeBlock', () => {
  it('builds a file_change block without a patch', () => {
    expect(
      fileChangeBlock(
        edgeEvent('evt-fc', 1, 'run.agent.file_change', {
          runId: 'run-1',
          path: 'app/shared/src/diff.ts',
          action: 'add',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-fc',
      author: AGENT_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
        { id: 'file-app/shared/src/diff.ts', kind: 'file', label: 'app/shared/src/diff.ts', path: 'app/shared/src/diff.ts' },
      ],
      kind: 'file_change',
      path: 'app/shared/src/diff.ts',
      action: 'created',
    });
  });

  it('extracts the path from content when payload.path is missing', () => {
    const block = fileChangeBlock(
      edgeEvent('evt-fc2', 2, 'run.agent.file_change', {
        runId: 'run-2',
        content: 'touched app/shared/src/foo.ts end',
      }),
    );
    expect(block?.path).toBe('app/shared/src/foo.ts');
    expect(block?.action).toBe('modified');
  });

  it('returns null when neither path nor a path-bearing content is present', () => {
    expect(
      fileChangeBlock(
        edgeEvent('evt-fc3', 3, 'run.agent.file_change', { content: 'no path here' }),
      ),
    ).toBeNull();
  });

  it('parses a patch into additions, deletions, and diff lines', () => {
    const patch = [
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,1 +1,1 @@',
      '- old',
      '+ new',
    ].join('\n');
    const block = fileChangeBlock(
      edgeEvent('evt-fc4', 4, 'run.agent.file_change', {
        runId: 'run-4',
        path: 'foo.ts',
        diff: patch,
      }),
    );
    expect(block).toMatchObject({
      kind: 'file_change',
      path: 'foo.ts',
      action: 'modified',
      additions: 1,
      deletions: 1,
      patch,
    });
    expect(block?.lines).toEqual([
      { type: 'del', content: ' old' },
      { type: 'add', content: ' new' },
    ]);
  });

  it('normalizes file actions from kind, action, and status fields', () => {
    const byKind = fileChangeBlock(
      edgeEvent('evt-fc5', 5, 'run.agent.file_change', { path: 'a.ts', kind: 'add' }),
    );
    expect(byKind?.action).toBe('created');

    const byAction = fileChangeBlock(
      edgeEvent('evt-fc6', 6, 'run.agent.file_change', { path: 'b.ts', action: 'remove' }),
    );
    expect(byAction?.action).toBe('deleted');

    const byStatus = fileChangeBlock(
      edgeEvent('evt-fc7', 7, 'run.agent.file_change', { path: 'c.ts', status: 'edit' }),
    );
    expect(byStatus?.action).toBe('modified');
  });

  it('carries edit/review/canApply/canRevert metadata, including false booleans', () => {
    const block = fileChangeBlock(
      edgeEvent('evt-fc8', 8, 'run.agent.file_change', {
        path: 'd.ts',
        edit_id: 'edit-1',
        review_status: 'pending',
        can_apply: false,
        can_revert: true,
      }),
    );
    expect(block).toMatchObject({
      editId: 'edit-1',
      reviewStatus: 'pending',
      canApply: false,
      canRevert: true,
    });
  });

  it('derives the author from payload agent id and name', () => {
    const block = fileChangeBlock(
      edgeEvent('evt-fc9', 9, 'run.agent.file_change', {
        path: 'e.ts',
        agentId: 'agent-b',
        agentName: 'Beta',
      }),
    );
    expect(block?.author).toEqual({ id: 'agent-b', name: 'Beta', role: 'agent' });
  });
});
