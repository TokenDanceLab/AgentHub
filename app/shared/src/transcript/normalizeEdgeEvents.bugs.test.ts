import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '../events';
import { normalizeEdgeEventsToTranscript } from './normalizeEdgeEvents';
import { vi } from 'vitest';

function edgeEvent(
  id: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  sentAt = `2026-06-07T03:00:0${seq}Z`,
  overrides?: Partial<EventEnvelope>,
): EventEnvelope {
  return {
    version: 'v1',
    id,
    seq,
    type,
    scope: {
      threadId: 'thread-live',
      runId: typeof payload.runId === 'string' ? payload.runId : undefined,
    },
    sentAt,
    payload,
    ...overrides,
  };
}

// ── BUG HUNT: Failing tests for known bugs ──────────────────────

describe('run.queued renders as text block with pending status', () => {
  it('run.queued event is mapped to a text block with status pending', () => {
    // FIX: run.queued removed from SKIPPED_EVENT_TYPES so the switch case is now reachable.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-queued', 1, 'run.queued', {
        runId: 'run-test-1',
      }),
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'edge-event-evt-queued',
        kind: 'text',
        author: { id: 'edge', name: 'Edge', role: 'system' },
        text: 'Run run-test-1 queued',
        evidenceRefs: [
          { id: 'run-run-test-1', kind: 'run', label: 'Run run-test-1', status: 'pending' },
        ],
      }),
    ]);
  });
});

describe('BUG: toolCallBlock — unreachable "Tool call" fallback label', () => {
  it('BUG: the "Tool call" fallback string is unreachable because the function returns null when both toolName and callId are missing', () => {
    // Line 404: if (!toolName && !callId) return null;
    // Line 407: label = toolName ?? callId ?? 'Tool call';
    // The 'Tool call' fallback can never be reached because if both are missing,
    // the function already returned null on line 404.
    // This is a dead-code / misleading-fallback bug.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-tool-no-name', 1, 'run.agent.tool_call', {
        runId: 'run-test-2',
        status: 'running',
        // No toolName, no callId
      }),
    ]);

    // Currently returns [] because the guard returns null.
    // The fallback 'Tool call' on line 407 is unreachable dead code.
    // If the fallback were reachable, this test would pass — but it never is.
    // This test documents the broken invariant.
    expect(blocks).toEqual([]);

    // BUG CONFIRMATION: verify that with ONLY a callId (no toolName), the label is the callId not a tool name
    const blocksWithCallId = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-tool-callid-only', 2, 'run.agent.tool_call', {
        runId: 'run-test-2',
        callId: 'call-abc-123',
        status: 'running',
      }),
    ]);

    // toolName is undefined, callId = 'call-abc-123'
    // label = undefined ?? 'call-abc-123' ?? 'Tool call' => 'call-abc-123'
    // The block.toolName is set to the callId, NOT the actual tool name
    expect(blocksWithCallId).toHaveLength(1);
    const block = blocksWithCallId[0]!;
    expect(block.kind).toBe('tool_call');
    // BUG: toolName is set to the callId value, not a real tool name
    // This conflates tool identity with invocation identity
    expect((block as { toolName: string }).toolName).toBe('call-abc-123');
    expect(block.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-call-abc-123',
          kind: 'tool',
          label: 'call-abc-123',
          status: 'running',
        }),
      ]),
    );
  });
});

describe('BUG: toolResultBlock — status mapping for errored results without explicit isError flag', () => {
  it('BUG: tool_result with only an error string should be mapped to failed status', () => {
    // Line 435: event.payload.isError === true || Boolean(stringField(event.payload.error))
    // This correctly detects error strings, but let's verify edge cases.
    // If isError is false but there is an error string, it still shows as failed.
    // This is arguably correct, but the converse matters:
    // If isError is true but NO error string, the block shows failed without a summary.
    const blocksWithError = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-tool-err', 1, 'run.agent.tool_result', {
        runId: 'run-test-3',
        callId: 'call-xyz',
        toolName: 'bash',
        error: 'command not found',
        // isError NOT explicitly set
      }),
    ]);

    expect(blocksWithError).toHaveLength(1);
    expect(blocksWithError[0]!.kind).toBe('tool_result');
    expect(blocksWithError[0]).toHaveProperty('status', 'failed');
    expect(blocksWithError[0]).toHaveProperty('summary', 'command not found');

    // Now test: isError=true but no error string
    const blocksIsErrorOnly = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-tool-iserr', 2, 'run.agent.tool_result', {
        runId: 'run-test-3',
        callId: 'call-abc',
        toolName: 'write',
        isError: true,
        // No error string
      }),
    ]);

    expect(blocksIsErrorOnly).toHaveLength(1);
    expect(blocksIsErrorOnly[0]!.kind).toBe('tool_result');
    expect(blocksIsErrorOnly[0]).toHaveProperty('status', 'failed');
    // BUG: When isError=true but no error string, summary is undefined
    // (cleanText on undefined returns undefined, and the ?? chain on lines 439-441
    //  would need content, but content is also undefined here)
    expect(blocksIsErrorOnly[0]).not.toHaveProperty('summary');
  });
});

describe('outputTextBlock and outputBatchTextBlock — missing runId now warns and falls back to event.id', () => {
  it('run.output without a runId produces a block with event.id fallback evidenceRef and console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-output-no-run', 1, 'run.output', {
        // No runId in payload
        stream: 'stdout',
        offset: 0,
        text: 'Hello world',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('text');
    expect(blocks[0]!.text).toBe('Hello world');
    // FIX: evidenceRefs now uses event.id as fallback run ID
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-evt-output-no-run', kind: 'run', label: 'Run evt-output-no-run', status: 'running' },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      'normalizeEdgeEvents: run.output missing runId, using event.id as fallback evidenceRef',
      { eventId: 'evt-output-no-run' },
    );
    warnSpy.mockRestore();
  });

  it('run.output.batch without a runId produces a block with event.id fallback evidenceRef', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-batch-no-run', 1, 'run.output.batch', {
        // No runId in payload
        stream: 'stdout',
        chunks: [{ offset: 0, text: 'line 1\n' }, { offset: 7, text: 'line 2' }],
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('text');
    expect(blocks[0]!.text).toBe('line 1line 2');
    // FIX: evidenceRefs now uses event.id as fallback run ID
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-evt-batch-no-run', kind: 'run', label: 'Run evt-batch-no-run', status: 'running' },
    ]);
  });
});

describe('agentTextBlock — missing runId warns and falls back to event.id', () => {
  it('run.agent.text_block without a runId produces a block with event.id fallback evidenceRef', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-text-no-run', 1, 'run.agent.text_delta', {
        content: 'Agent says hello',
        // No runId
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('text');
    expect(blocks[0]!.text).toBe('Agent says hello');
    // FIX: evidenceRefs now uses event.id as fallback run ID
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-evt-text-no-run', kind: 'run', label: 'Run evt-text-no-run', status: 'running' },
    ]);
  });
});

describe('BUG: contextUsageBlock — both inputTokens and outputTokens default to 0 when missing', () => {
  it('BUG: context_usage block defaults input/output to 0, producing misleading zero-token blocks', () => {
    // Line 391-392: inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0
    // If neither input nor output tokens are provided, the block shows 0/0 tokens
    // This is misleading — a missing reading should arguably be absent, not zero.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-ctx-zero', 1, 'run.agent.context_usage', {
        runId: 'run-test-4',
        model: 'test-model',
        // No inputTokens, no outputTokens
        // But line 364: inputTokens == null && outputTokens == null → return null
        // So actually, it DOES return null! Let's test that...
      }),
    ]);

    // Good: handler returns null when both are missing (line 364 check)
    expect(blocks).toEqual([]);

    // But what about when only ONE is present?
    const blocksInputOnly = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-ctx-input', 2, 'run.agent.context_usage', {
        runId: 'run-test-4',
        inputTokens: 5000,
        // No outputTokens
      }),
    ]);

    expect(blocksInputOnly).toHaveLength(1);
    expect(blocksInputOnly[0]!.kind).toBe('context_usage');
    const ctxBlock = blocksInputOnly[0]! as { inputTokens: number; outputTokens: number };
    expect(ctxBlock.inputTokens).toBe(5000);
    // BUG: outputTokens defaults to 0 when missing — should this be undefined/absent instead?
    // A block with 5000 input and 0 output is misleading if the output was simply unavailable
    expect(ctxBlock.outputTokens).toBe(0);
  });
});

describe('BUG: permissionRequestedBlock — event.id used as fallback requestId', () => {
  it('when neither requestId nor approvalId is present, event.id is used as block requestId but approval evidenceRef is skipped', () => {
    // FIX: requestId no longer falls back to event.id for evidenceRef.
    // The block-level requestId still falls back to event.id so the UI has a handle,
    // but the approval evidenceRef is omitted because there's no real approval ID
    // to correlate with permission_decided events.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-perm-no-requestId', 1, 'run.agent.permission_requested', {
        runId: 'run-test-5',
        toolName: 'dangerous-tool',
        // No requestId, no approvalId
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('permission_request');
    const permBlock = blocks[0]! as { requestId: string; title: string };
    // requestId falls back to event.id for UI display
    expect(permBlock.requestId).toBe('evt-perm-no-requestId');
    // FIX: approval evidenceRef is NOT created because there's no real approval ID
    // Only the run evidenceRef is present
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-test-5', kind: 'run', label: 'Run run-test-5', status: 'pending' },
    ]);
  });
});

describe('BUG: permissionDecidedBlock — event.id used as fallback requestId', () => {
  it('approval.decided without requestId or approvalId uses event.id as block requestId but skips approval evidenceRef', () => {
    // FIX: Same pattern as permission_request — evidenceRef skips approval when
    // no real approval ID, but block-level requestId still uses event.id as fallback.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-decided-no-id', 1, 'approval.decided', {
        runId: 'run-test-6',
        decision: 'approved',
        // No requestId, no approvalId
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('permission_result');
    const resultBlock = blocks[0]! as { requestId: string };
    // requestId falls back to event.id for UI display
    expect(resultBlock.requestId).toBe('evt-decided-no-id');
    // FIX: No approval evidenceRef — only run evidence
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-test-6', kind: 'run', label: 'Run run-test-6', status: 'completed' },
    ]);
  });
});

describe('BUG: subagentBlock — missing worker causes null return but the full event is discarded', () => {
  it('BUG: subagent event with title but no worker is silently discarded', () => {
    // Line 251: if (!title || !worker) return null;
    // If title exists but worker is missing, the entire subagent event is dropped.
    // This could lose important context — e.g., a title-only subagent event.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-sub-no-worker', 1, 'run.agent.subagent', {
        runId: 'run-test-7',
        taskId: 'task-abc',
        title: 'Important subagent task',
        // No worker
      }),
    ]);

    // BUG: Event is silently dropped — no block produced
    expect(blocks).toEqual([]);
  });
});

describe('BUG: childAgentBlock — missing agent causes silent drop', () => {
  it('BUG: child_agent event with title but no agent name is silently discarded', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-child-no-agent', 1, 'run.agent.child_agent', {
        runId: 'run-test-8',
        childId: 'child-xyz',
        title: 'Parallel analysis task',
        // No agent/agentName/worker/workerName
      }),
    ]);

    // BUG: Event is silently dropped
    expect(blocks).toEqual([]);
  });
});

describe('BUG: runFinishedBlock — evidenceRef uses hardcoded "completed" status ignoring payload', () => {
  it('BUG: run.finished always maps evidenceRef to "completed" even if payload indicates different status', () => {
    // Line 168: runEvidence(runId, 'completed')
    // This is hardcoded — if the run was actually cancelled-but-finished-event-emitted,
    // the evidenceRef would incorrectly show 'completed'.
    // However, per the event spec, run.finished always means completed, so this is
    // more of a design note. The real BUG is that runCancelledBlock also maps to
    // evidenceRef status 'failed', which is correct. Let's instead verify:
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-finished', 1, 'run.finished', {
        runId: 'run-test-9',
        finishedAt: '2026-06-07T03:00:10Z',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('finished');
    // Status IS hardcoded to 'completed' — this is by design
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-test-9', kind: 'run', label: 'Run run-test-9', status: 'completed' },
    ]);
  });
});

describe('BUG: runCancelledBlock — evidenceRef status hardcoded to "failed" instead of using normalizeEvidenceStatus', () => {
  it('BUG: run.cancelled event hardcodes evidenceRef to "failed" without considering a dedicated "cancelled" status', () => {
    // Line 152: runEvidence(runId, 'failed')
    // normalizeEvidenceStatus('cancelled') also returns 'failed', so this is consistent.
    // BUT: it means cancelled and failed runs are indistinguishable at the evidence level.
    // This is arguably a design issue — a cancelled run is semantically different from a failed run.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-cancelled', 1, 'run.cancelled', {
        runId: 'run-test-10',
        reason: 'User requested cancellation',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('failure');
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-test-10', kind: 'run', label: 'Run run-test-10', status: 'failed' },
    ]);
    // NOTE: There's no way to distinguish "cancelled" from "failed" in evidenceRefs
    // because EvidenceRefStatus only has 'pending' | 'running' | 'completed' | 'failed'
    // (no 'cancelled' in the union)
  });
});

describe('BUG: runCancelledBlock and runFailedBlock — identical code path for different semantics', () => {
  it('BUG: cancelled and failed blocks share the same reason extraction logic but produce slightly different titles', () => {
    // Cancelled: title = "Run {id} cancelled", evidenceRef status = 'failed'
    // Failed:   title = "Run {id} failed",    evidenceRef status = 'failed'
    // The only difference is the title string — both use the same status
    const cancelled = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-c', 1, 'run.cancelled', { runId: 'run-x', reason: 'cancelled by user' }),
    ]);
    const failed = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-f', 1, 'run.failed', { runId: 'run-x', reason: 'crash' }),
    ]);

    expect(cancelled[0]!.kind).toBe('failure');
    expect(failed[0]!.kind).toBe('failure');
    // Both evidenceRefs are identical except event ID
    expect(cancelled[0]!.evidenceRefs).toEqual(failed[0]!.evidenceRefs);
  });
});

describe('BUG: thinkingBlock — empty content string edge case', () => {
  it('BUG: run.agent.thinking with whitespace-only content returns null because stringField trims to empty', () => {
    // Line 223: const content = cleanText(stringField(event.payload.content));
    // stringField trims, cleanText checks truthiness. Whitespace-only content becomes '' then undefined.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-thinking-empty', 1, 'run.agent.thinking', {
        runId: 'run-test-11',
        content: '   \n  ',
      }),
    ]);

    // BUG: Whitespace-only thinking blocks are silently dropped
    // This might be intentional, but it could also lose data if content was meaningful whitespace
    expect(blocks).toEqual([]);
  });
});

describe('BUG: fileChangeBlock — missing path field causes null return', () => {
  it('BUG: file_change event without a path is silently discarded even if it has a diff', () => {
    // Line 456-457: path = stringField(event.payload.path) ?? pathFromContent(stringField(event.payload.content));
    // If neither yields a path, returns null despite potentially having valuable diff data.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-file-no-path', 1, 'run.agent.file_change', {
        runId: 'run-test-12',
        diff: '@@ -1 +1 @@\n-old\n+new',
        kind: 'modified',
        // No path, no content with a path
      }),
    ]);

    // BUG: Entire file change event is dropped because path couldn't be extracted
    expect(blocks).toEqual([]);
  });
});

describe('BUG: routeDecisionBlock — missing action field causes null return', () => {
  it('BUG: route_decision event with summary but no action is silently dropped', () => {
    // Line 339-340: action = stringField(event.payload.action) ?? stringField(event.payload.kind);
    // if (!action) return null;
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-route-no-action', 1, 'run.agent.route_decision', {
        runId: 'run-test-13',
        summary: 'Complex routing decision',
        targetAgent: 'Reviewer',
        // No action, no kind
      }),
    ]);

    // BUG: Valuable context (summary + targetAgent) is lost because action is missing
    expect(blocks).toEqual([]);
  });
});

describe('BUG: previewStoppedBlock — missing previewId returns null', () => {
  it('BUG: preview.stopped event without previewId is silently dropped', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-preview-stop-no-id', 1, 'preview.stopped', {
        runId: 'run-test-14',
        // No previewId, no id
      }),
    ]);

    expect(blocks).toEqual([]);
  });
});

describe('BUG: agentResultBlock — missing runId returns null', () => {
  it('BUG: run.agent.result without runId is silently dropped', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-result-no-run', 1, 'run.agent.result', {
        success: true,
        summary: 'All tasks completed',
        // No runId
      }),
    ]);

    expect(blocks).toEqual([]);
  });
});

describe('BUG: runStatusChanged — run.status.changed with unknown status defaults to "running"', () => {
  it('BUG: unrecognized status values default to "running" without any warning', () => {
    // Line 115: const status = normalizeEvidenceStatus(statusText);
    // normalizeEvidenceStatus returns 'running' for any unrecognized status (line 817-818)
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-status-unknown', 1, 'run.status.changed', {
        runId: 'run-test-15',
        status: 'mysterious-new-status',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    // BUG: Unknown status 'mysterious-new-status' is silently mapped to 'running'
    // The text preserves the original status, but the evidenceRef is wrong
    expect(blocks[0]!.text).toBe('Run run-test-15 mysterious-new-status');
    // EvidenceRef says 'running' but the text says 'mysterious-new-status'
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-test-15', kind: 'run', label: 'Run run-test-15', status: 'running' },
    ]);
  });
});

describe('BUG: normalizeEvidenceStatus — cancelled and failed are the same', () => {
  it('BUG: "cancelled" status collapses into "failed" with no way to distinguish them', () => {
    // Lines 804-809: both 'cancelled' and 'failed' map to the same EvidenceRefStatus 'failed'
    // This means cancelled runs and failed runs are visually indistinguishable in the transcript
    // at the evidence level. The block kind ('failure') is the same for both.

    // Verify via run.status.changed with cancelled status
    const cancelled = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-status-cancelled', 1, 'run.status.changed', {
        runId: 'run-test-16',
        status: 'cancelled',
      }),
    ]);
    const failed = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-status-failed', 2, 'run.status.changed', {
        runId: 'run-test-16',
        status: 'failed',
      }),
    ]);

    // Both produce identical evidenceRef status
    expect(cancelled[0]!.evidenceRefs).toEqual(failed[0]!.evidenceRefs);
  });
});

describe('BUG: runStatusBlock — empty status text causes null return even with valid runId', () => {
  it('BUG: run.status.changed with empty/whitespace status is silently dropped', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-status-empty', 1, 'run.status.changed', {
        runId: 'run-test-17',
        status: '   ',
      }),
    ]);

    // BUG: If status is whitespace-only, stringField returns undefined and the block is dropped
    expect(blocks).toEqual([]);
  });
});

describe('BUG: event sorting — events without sentAt get POSITIVE_INFINITY timestamp', () => {
  it('consecutive text_delta blocks merge (Infinity-timestamp events merge with earlier valid-timestamp ones)', () => {
    // text_delta events with same author are now merged into a single block
    // to prevent streaming thrashing. This means the event with unparseable
    // date is merged into the earlier block rather than appearing separately.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-no-date', 999, 'run.agent.text_delta', {
        runId: 'run-test-18',
        content: 'should be last',
      }, 'invalid-date-that-doesnt-parse'),
      edgeEvent('evt-normal', 1, 'run.agent.text_delta', {
        runId: 'run-test-18',
        content: 'should be first',
      }, '2026-06-07T03:00:01Z'),
    ]);

    // After sorting: [evt-normal (valid date), evt-no-date (Infinity)]
    // After merge: single text block with concatenated content
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.id).toBe('edge-event-evt-normal');
    expect(blocks[0]!.kind).toBe('text');
    expect(blocks[0]!.text).toBe('should be firstshould be last');
  });
});

describe('BUG: runTextBlock — missing runId returns null', () => {
  it('BUG: run.started without a runId is silently dropped', () => {
    // Line 101-102: const runId = eventRunId(event); if (!runId) return null;
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-started-no-run', 1, 'run.started', {
        startedAt: '2026-06-07T03:00:00Z',
        // No runId in payload
      }),
    ]);

    expect(blocks).toEqual([]);
  });
});

describe('BUG: runFinishedBlock — missing runId returns null', () => {
  it('BUG: run.finished without a runId is silently dropped', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-finished-no-run', 1, 'run.finished', {
        finishedAt: '2026-06-07T03:00:10Z',
        // No runId
      }),
    ]);

    expect(blocks).toEqual([]);
  });
});

describe('BUG: runFailedBlock — missing runId returns null', () => {
  it('BUG: run.failed without a runId is silently dropped', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-failed-no-run', 1, 'run.failed', {
        reason: 'something went wrong',
        // No runId
      }),
    ]);

    expect(blocks).toEqual([]);
  });
});

describe('BUG: runCancelledBlock — missing runId returns null', () => {
  it('BUG: run.cancelled without a runId is silently dropped', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-cancelled-no-run', 1, 'run.cancelled', {
        reason: 'User cancelled',
        // No runId
      }),
    ]);

    expect(blocks).toEqual([]);
  });
});

describe('BUG: toolCallBlock — missing both toolName AND callId returns null', () => {
  it('BUG: tool_call event with only status returns null', () => {
    // Line 404: if (!toolName && !callId) return null;
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-tool-bare', 1, 'run.agent.tool_call', {
        runId: 'run-test-19',
        status: 'completed',
        // No toolName, no callId
      }),
    ]);

    expect(blocks).toEqual([]);
  });
});

describe('BUG: toolResultBlock — missing toolName AND callId returns null', () => {
  it('BUG: tool_result event with no identifiable tool name is silently dropped', () => {
    // Line 432-434: toolName = ... ; if (!toolName) return null;
    // toolName falls back to callId, but if BOTH are missing, null is returned
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-result-no-name', 1, 'run.agent.tool_result', {
        runId: 'run-test-20',
        isError: true,
        // No toolName, no name, no callId
      }),
    ]);

    expect(blocks).toEqual([]);
  });
});

describe('BUG: artifactCreatedBlock — missing all identifying fields returns null', () => {
  it('BUG: artifact.created event with only a runId is silently dropped', () => {
    // artifactId on line 581: stringField(event.payload.artifactId) ?? event.id
    // If event.id is present but path/title/uri/kind are all missing, title is set to event.id
    // Wait — let's verify: artifactId = ... ?? event.id (always present)
    // title = path ?? title ?? uri ?? kind ?? artifactId
    // If all are missing, title = artifactId = event.id. So it SHOULD produce a block.
    // Let's verify the minimum case
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-artifact-min', 1, 'artifact.created', {
        runId: 'run-test-21',
        // Only runId — everything else missing
      }),
    ]);

    // artifactId = event.id = 'evt-artifact-min'
    // title = undefined ?? undefined ?? undefined ?? undefined ?? 'evt-artifact-min' = 'evt-artifact-min'
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('artifact');
    const artBlock = blocks[0]! as { title: string };
    // BUG: title is set to the event ID, which is not a meaningful title
    expect(artBlock.title).toBe('evt-artifact-min');
  });
});

describe('BUG: empty events array returns empty array', () => {
  it('handles undefined input', () => {
    const blocks = normalizeEdgeEventsToTranscript(undefined);
    expect(blocks).toEqual([]);
  });

  it('handles empty array', () => {
    const blocks = normalizeEdgeEventsToTranscript([]);
    expect(blocks).toEqual([]);
  });
});
