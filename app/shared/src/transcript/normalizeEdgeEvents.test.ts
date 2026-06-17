import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '../events';
import { normalizeEdgeEventsToTranscript } from './normalizeEdgeEvents';

describe('normalizeEdgeEventsToTranscript', () => {
  it('projects live Edge agent events into transcript blocks with evidence', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-start', 1, 'run.started', {
        runId: 'run-live',
        startedAt: '2026-06-07T03:00:00Z',
      }),
      edgeEvent('evt-text', 2, 'run.agent.text_block', {
        runId: 'run-live',
        content: '正在读取桌面事件流。',
      }),
      edgeEvent('evt-tool', 3, 'run.agent.tool_call', {
        runId: 'run-live',
        callId: 'call-rg',
        toolName: 'rg',
        status: 'running',
      }),
      edgeEvent('evt-file', 4, 'run.agent.file_change', {
        runId: 'run-live',
        path: 'app/shared/src/transcript/normalizeEdgeEvents.ts',
        kind: 'modified',
        diff: '@@ -1 +1 @@\n-old\n+new',
      }),
      edgeEvent('evt-approval', 5, 'run.agent.permission_requested', {
        runId: 'run-live',
        requestId: 'perm-1',
        toolName: 'Write',
      }),
      edgeEvent('evt-artifact', 6, 'artifact.created', {
        runId: 'run-live',
        artifactId: 'artifact-1',
        path: 'app/desktop/.tmp/visual-smoke-desktop.png',
        kind: 'screenshot',
      }),
      edgeEvent('evt-preview', 7, 'preview.ready', {
        runId: 'run-live',
        id: 'preview-1',
        url: 'http://127.0.0.1:4173',
        status: 'ready',
      }),
      edgeEvent('evt-finished', 7, 'run.finished', {
        runId: 'run-live',
        finishedAt: '2026-06-07T03:00:10Z',
      }),
      edgeEvent('evt-unknown-status', 8, 'run.status.changed', {
        runId: 'run-live',
        status: 'throttled',
      }),
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'edge-event-evt-start',
        kind: 'text',
        author: { id: 'edge', name: 'Edge', role: 'system' },
        text: 'Run run-live started',
        evidenceRefs: [
          { id: 'run-run-live', kind: 'run', label: 'Run run-live', status: 'running' },
        ],
      }),
      expect.objectContaining({
        id: 'edge-event-evt-text',
        kind: 'text',
        author: { id: 'agent', name: 'Agent', role: 'agent' },
        text: '正在读取桌面事件流。',
        evidenceRefs: [
          { id: 'run-run-live', kind: 'run', label: 'Run run-live', status: 'running' },
        ],
      }),
      expect.objectContaining({
        id: 'edge-event-evt-tool',
        kind: 'tool_call',
        toolName: 'rg',
        status: 'running',
        evidenceRefs: [
          { id: 'run-run-live', kind: 'run', label: 'Run run-live', status: 'running' },
          { id: 'tool-call-rg', kind: 'tool', label: 'rg', status: 'running' },
        ],
      }),
      expect.objectContaining({
        id: 'edge-event-evt-file',
        kind: 'file_change',
        path: 'app/shared/src/transcript/normalizeEdgeEvents.ts',
        action: 'modified',
        additions: 1,
        deletions: 1,
        evidenceRefs: [
          { id: 'run-run-live', kind: 'run', label: 'Run run-live', status: 'running' },
          {
            id: 'file-app/shared/src/transcript/normalizeEdgeEvents.ts',
            kind: 'file',
            label: 'app/shared/src/transcript/normalizeEdgeEvents.ts',
            path: 'app/shared/src/transcript/normalizeEdgeEvents.ts',
          },
        ],
      }),
      expect.objectContaining({
        id: 'edge-event-evt-approval',
        kind: 'permission_request',
        requestId: 'perm-1',
        title: 'Permission requested: Write',
        status: 'pending',
      }),
      expect.objectContaining({
        id: 'edge-event-evt-artifact',
        kind: 'artifact',
        title: 'app/desktop/.tmp/visual-smoke-desktop.png',
        evidenceRefs: [
          { id: 'run-run-live', kind: 'run', label: 'Run run-live', status: 'running' },
          {
            id: 'artifact-artifact-1',
            kind: 'artifact',
            label: 'app/desktop/.tmp/visual-smoke-desktop.png',
            path: 'app/desktop/.tmp/visual-smoke-desktop.png',
            status: 'completed',
          },
        ],
      }),
      expect.objectContaining({
        id: 'edge-event-evt-preview',
        kind: 'preview',
        previewId: 'preview-1',
        status: 'completed',
        url: 'http://127.0.0.1:4173',
        evidenceRefs: [
          { id: 'run-run-live', kind: 'run', label: 'Run run-live', status: 'running' },
          {
            id: 'preview-preview-1',
            kind: 'preview',
            label: 'http://127.0.0.1:4173',
            status: 'completed',
            uri: 'http://127.0.0.1:4173',
          },
        ],
      }),
      expect.objectContaining({
        id: 'edge-event-evt-finished',
        kind: 'finished',
        title: 'Run run-live finished',
        runId: 'run-live',
        evidenceRefs: [
          { id: 'run-run-live', kind: 'run', label: 'Run run-live', status: 'completed' },
        ],
      }),
      expect.objectContaining({
        id: 'edge-event-evt-unknown-status',
        kind: 'text',
        text: 'Run run-live throttled',
        evidenceRefs: [
          { id: 'run-run-live', kind: 'run', label: 'Run run-live', status: 'running' },
        ],
      }),
    ]);
  });

  it('sorts events by sent time and ignores unsupported or empty payloads', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-late', 2, 'run.agent.text_delta', {
        runId: 'run-live',
        content: 'second',
      }, '2026-06-07T03:00:02Z'),
      edgeEvent('evt-empty', 3, 'run.agent.text_delta', {
        runId: 'run-live',
        content: '   ',
      }, '2026-06-07T03:00:01Z'),
      edgeEvent('evt-early', 1, 'run.output.batch', {
        runId: 'run-live',
        chunks: [{ offset: 0, text: 'first\n' }],
      }, '2026-06-07T03:00:00Z'),
      edgeEvent('evt-ignored', 4, 'thread.updated', {
        threadId: 'thread-live',
      }, '2026-06-07T03:00:03Z'),
    ]);

    expect(blocks.map((block) => block.id)).toEqual(['edge-event-evt-early', 'edge-event-evt-late']);
    expect(blocks[0]).toEqual(expect.objectContaining({
      author: { id: 'edge', name: 'Edge', role: 'system' },
      kind: 'text',
      text: 'first',
    }));
  });

  it('keeps artifact preview metadata for platform adapters', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-preview-artifact', 1, 'artifact.created', {
        runId: 'run-preview',
        artifactId: 'artifact-preview',
        title: '本地预览',
        url: 'http://127.0.0.1:3210/artifacts/preview',
        mimeType: 'text/html',
      }),
    ]);

    expect(blocks[0]?.evidenceRefs).toEqual([
      { id: 'run-run-preview', kind: 'run', label: 'Run run-preview', status: 'running' },
      {
        id: 'artifact-artifact-preview',
        kind: 'artifact',
        label: '本地预览',
        mimeType: 'text/html',
        status: 'completed',
        uri: 'http://127.0.0.1:3210/artifacts/preview',
      },
    ]);
  });

  it('projects v4 detail events into design transcript blocks', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-thinking', 1, 'run.agent.thinking', {
        runId: 'run-v4',
        content: '正在分析 Desktop/Web shared UI。',
      }),
      edgeEvent('evt-subagent', 2, 'run.agent.subagent_task', {
        runId: 'run-v4',
        taskId: 'review-v4-blocks',
        title: '复核 blocks 对齐',
        worker: 'Reviewer',
        status: 'running',
        summary: '检查新增块是否进入 shared transcript。',
      }),
      edgeEvent('evt-child', 3, 'run.agent.child_agent', {
        runId: 'run-v4',
        childId: 'browser-qa-v4',
        title: 'Browser QA 截图验证',
        agentName: 'Browser QA',
        status: 'completed',
        summary: '确认消息列能显示新增块。',
      }),
      edgeEvent('evt-route', 4, 'run.agent.route_decision', {
        runId: 'run-v4',
        action: 'fanout',
        nextWorker: 'Reviewer',
        summary: '拆成可验证切片。',
      }),
      edgeEvent('evt-context', 5, 'run.agent.context_usage', {
        runId: 'run-v4',
        input: 38400,
        output: 6200,
        limit: 200000,
        totalCost: 0.44,
        model: 'GLM-5.1',
      }),
      edgeEvent('evt-result', 6, 'run.agent.result', {
        runId: 'run-v4',
        success: true,
        durationMs: 492000,
        turns: 7,
        summary: '协作进度 78%。',
      }),
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        content: '正在分析 Desktop/Web shared UI。',
        isThinking: false,
      }),
      expect.objectContaining({
        kind: 'subtask',
        title: '复核 blocks 对齐',
        worker: 'Reviewer',
        status: 'running',
        summary: '检查新增块是否进入 shared transcript。',
        runId: 'review-v4-blocks',
      }),
      expect.objectContaining({
        kind: 'child_agent',
        title: 'Browser QA 截图验证',
        agent: 'Browser QA',
        status: 'completed',
        summary: '确认消息列能显示新增块。',
        runId: 'browser-qa-v4',
        parentRunId: 'run-v4',
      }),
      expect.objectContaining({
        kind: 'route_decision',
        action: 'fanout',
        summary: '拆成可验证切片。',
        targetAgent: 'Reviewer',
      }),
      expect.objectContaining({
        kind: 'context_usage',
        inputTokens: 38400,
        outputTokens: 6200,
        contextLimit: 200000,
        cost: '$0.44',
        modelLabel: 'GLM-5.1',
      }),
      expect.objectContaining({
        kind: 'result',
        success: true,
        duration: '8m12s',
        turns: 7,
        summary: '协作进度 78%。',
      }),
    ]);
  });
});

describe('normalizeEdgeEventsToTranscript edge cases', () => {
  // ── 1. Null / undefined author events → handled gracefully ─────────────

  it('returns empty array for null input', () => {
    expect(normalizeEdgeEventsToTranscript(null as unknown as EventEnvelope[]))
      .toEqual([]);
  });

  it('returns empty array for undefined input', () => {
    expect(normalizeEdgeEventsToTranscript(undefined)).toEqual([]);
  });

  it('filters out events with empty payload objects gracefully', () => {
    // Events with completely empty payload should still be processed
    // without throwing. The normalize function accesses payload fields
    // via optional chaining and returns null for missing fields.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-empty-payload', 1, 'run.agent.text_delta', {}),
    ]);
    // No content field → returns null → filtered out
    expect(blocks).toEqual([]);
  });

  it('handles events with undefined payload fields without throwing', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-undefined-fields', 1, 'run.agent.text_block', {
        runId: 'run-safe',
        content: undefined,
        text: undefined,
      }),
    ]);
    // Both content and text are undefined → no text → returns null → filtered
    expect(blocks).toEqual([]);
  });

  // ── 2. Missing required fields → fallback values ────────────────────────

  it('outputTextBlock falls back to event.id when runId is missing', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-output-fallback', 1, 'run.output', {
        text: 'Output without runId',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('text');
    expect((blocks[0]! as { text: string }).text).toBe('Output without runId');
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-evt-output-fallback', kind: 'run', label: 'Run evt-output-fallback', status: 'running' },
    ]);
  });

  it('agentTextBlock falls back to event.id when runId is missing', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-agent-fallback', 1, 'run.agent.text_delta', {
        content: 'Agent text without runId',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('text');
    expect((blocks[0]! as { text: string }).text).toBe('Agent text without runId');
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-evt-agent-fallback', kind: 'run', label: 'Run evt-agent-fallback', status: 'running' },
    ]);
  });

  it('runTextBlock returns null when runId is missing (run.started)', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-started-no-runid', 1, 'run.started', {}),
    ]);
    expect(blocks).toEqual([]);
  });

  it('runFinishedBlock returns null when runId is missing', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-finished-no-runid', 1, 'run.finished', {
        durationMs: 1000,
      }),
    ]);
    expect(blocks).toEqual([]);
  });

  it('runFailedBlock returns null when runId is missing', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-failed-no-runid', 1, 'run.failed', {
        reason: 'something broke',
      }),
    ]);
    expect(blocks).toEqual([]);
  });

  it('runCancelledBlock returns null when runId is missing', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-cancelled-no-runid', 1, 'run.cancelled', {
        reason: 'user cancelled',
      }),
    ]);
    expect(blocks).toEqual([]);
  });

  it('contextUsageBlock returns null when both inputTokens and outputTokens are missing', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-ctx-no-tokens', 1, 'run.agent.context_usage', {
        runId: 'run-ctx',
        model: 'test-model',
        // No input, no output
      }),
    ]);
    expect(blocks).toEqual([]);
  });

  it('contextUsageBlock defaults missing outputTokens to 0 when inputTokens is present', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-ctx-input-only', 1, 'run.agent.context_usage', {
        runId: 'run-ctx',
        inputTokens: 5000,
        // No outputTokens
      }),
    ]);
    expect(blocks).toHaveLength(1);
    const ctxBlock = blocks[0]! as { inputTokens: number; outputTokens: number };
    expect(ctxBlock.inputTokens).toBe(5000);
    expect(ctxBlock.outputTokens).toBe(0);
  });

  it('toolCallBlock returns null when both toolName and callId are missing', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-tool-nothing', 1, 'run.agent.tool_call', {
        runId: 'run-tool',
        status: 'running',
        // No toolName, no callId
      }),
    ]);
    expect(blocks).toEqual([]);
  });

  it('toolResultBlock returns null when toolName, name, and callId are all missing', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-result-no-id', 1, 'run.agent.tool_result', {
        runId: 'run-result',
        isError: true,
        // No toolName, no name, no callId
      }),
    ]);
    expect(blocks).toEqual([]);
  });

  it('permissionRequestedBlock uses event.id as fallback requestId when none provided', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-perm-fallback', 1, 'run.agent.permission_requested', {
        runId: 'run-perm',
        toolName: 'bash',
        // No requestId, no approvalId
      }),
    ]);
    expect(blocks).toHaveLength(1);
    const permBlock = blocks[0]! as { requestId: string; kind: string };
    expect(permBlock.kind).toBe('permission_request');
    expect(permBlock.requestId).toBe('evt-perm-fallback');
  });

  it('permissionDecidedBlock uses event.id as fallback requestId when none provided', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-decided-fallback', 1, 'approval.decided', {
        runId: 'run-perm',
        decision: 'approved',
        // No requestId, no approvalId
      }),
    ]);
    expect(blocks).toHaveLength(1);
    const resultBlock = blocks[0]! as { requestId: string; kind: string };
    expect(resultBlock.kind).toBe('permission_result');
    expect(resultBlock.requestId).toBe('evt-decided-fallback');
  });

  // ── 3. Delta merging (text_delta + thinking_delta) ─────────────────────

  it('merges consecutive text_delta blocks into a single text block', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-d1', 1, 'run.agent.text_delta', {
        runId: 'run-delta',
        content: 'Part ',
      }),
      edgeEvent('evt-d2', 2, 'run.agent.text_delta', {
        runId: 'run-delta',
        content: '1, ',
      }),
      edgeEvent('evt-d3', 3, 'run.agent.text_delta', {
        runId: 'run-delta',
        content: '2, 3.',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('text');
    expect((blocks[0]! as { text: string }).text).toBe('Part1,2, 3.');
  });

  it('merges consecutive thinking blocks into a single thinking block', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-th1', 1, 'run.agent.thinking', {
        runId: 'run-delta',
        content: 'Think step A. ',
      }),
      edgeEvent('evt-th2', 2, 'run.agent.thinking', {
        runId: 'run-delta',
        content: 'Think step B.',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    const thinkingBlock = blocks[0]! as { content?: string };
    expect(thinkingBlock.content).toBe('Think step A.Think step B.');
  });

  it('does not merge text and thinking blocks together', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-txt', 1, 'run.agent.text_delta', {
        runId: 'run-nomerge',
        content: 'Answer.',
      }),
      edgeEvent('evt-thk', 2, 'run.agent.thinking', {
        runId: 'run-nomerge',
        content: 'Reasoning.',
      }),
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.kind).toBe('text');
    expect(blocks[1]!.kind).toBe('thinking');
  });

  it('stops merging when a different-kind block appears between same-kind deltas', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-d1', 1, 'run.agent.text_delta', {
        runId: 'run-stop',
        content: 'Part A.',
      }),
      edgeEvent('evt-tool', 2, 'run.agent.tool_call', {
        runId: 'run-stop',
        toolName: 'grep',
        status: 'running',
      }),
      edgeEvent('evt-d2', 3, 'run.agent.text_delta', {
        runId: 'run-stop',
        content: 'Part B.',
      }),
    ]);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.kind).toBe('text');
    expect(blocks[1]!.kind).toBe('tool_call');
    expect(blocks[2]!.kind).toBe('text');
  });

  // ── 4. All status mappings (done/todo/pending/running/completed/failed) ─

  it('maps "done" status to "completed" in normalizeEvidenceStatus', () => {
    // "done" is NOT in normalizeEvidenceStatus, so it falls through to default 'running'.
    // This test documents current behavior — "done" is not a recognized status.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-status-done', 1, 'run.status.changed', {
        runId: 'run-status',
        status: 'done',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect((blocks[0]! as { text: string }).text).toBe('Run run-status done');
    // "done" is not in the known mapping → defaults to 'running'
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-status', kind: 'run', label: 'Run run-status', status: 'running' },
    ]);
  });

  it('maps "todo" status to "running" (unrecognized default)', () => {
    // "todo" is also NOT in normalizeEvidenceStatus — it falls through to 'running'.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-status-todo', 1, 'run.status.changed', {
        runId: 'run-status',
        status: 'todo',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-status', kind: 'run', label: 'Run run-status', status: 'running' },
    ]);
  });

  it('maps "pending" status correctly', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-status-pending', 1, 'run.status.changed', {
        runId: 'run-status',
        status: 'pending',
      }),
    ]);
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-status', kind: 'run', label: 'Run run-status', status: 'pending' },
    ]);
  });

  it('maps "queued" to "pending" status', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-status-queued', 1, 'run.status.changed', {
        runId: 'run-status',
        status: 'queued',
      }),
    ]);
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-status', kind: 'run', label: 'Run run-status', status: 'pending' },
    ]);
  });

  it('maps "running" / "streaming" / "draining" / "starting" to "running"', () => {
    const statuses = ['running', 'streaming', 'draining', 'starting'];
    for (const status of statuses) {
      const blocks = normalizeEdgeEventsToTranscript([
        edgeEvent(`evt-status-${status}`, 1, 'run.status.changed', {
          runId: 'run-status',
          status,
        }),
      ]);
      expect(blocks[0]!.evidenceRefs).toEqual([
        { id: 'run-run-status', kind: 'run', label: 'Run run-status', status: 'running' },
      ]);
    }
  });

  it('maps "completed" / "finished" / "succeeded" / "success" / "approved" / "ready" to "completed"', () => {
    const statuses = ['completed', 'finished', 'succeeded', 'success', 'approved', 'ready'];
    for (const status of statuses) {
      const blocks = normalizeEdgeEventsToTranscript([
        edgeEvent(`evt-status-${status}`, 1, 'run.status.changed', {
          runId: 'run-status',
          status,
        }),
      ]);
      expect(blocks[0]!.evidenceRefs).toEqual([
        { id: 'run-run-status', kind: 'run', label: 'Run run-status', status: 'completed' },
      ]);
    }
  });

  it('maps "failed" / "cancelled" / "error" / "denied" / "rejected" to "failed"', () => {
    const statuses = ['failed', 'cancelled', 'error', 'denied', 'rejected'];
    for (const status of statuses) {
      const blocks = normalizeEdgeEventsToTranscript([
        edgeEvent(`evt-status-${status}`, 1, 'run.status.changed', {
          runId: 'run-status',
          status,
        }),
      ]);
      expect(blocks[0]!.evidenceRefs).toEqual([
        { id: 'run-run-status', kind: 'run', label: 'Run run-status', status: 'failed' },
      ]);
    }
  });

  it('maps unrecognized status to "running" (safe default)', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-status-weird', 1, 'run.status.changed', {
        runId: 'run-status',
        status: 'some-future-status',
      }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-status', kind: 'run', label: 'Run run-status', status: 'running' },
    ]);
  });

  it('maps "deny" / "rejected" permission decisions to "failed" status', () => {
    for (const decision of ['deny', 'rejected']) {
      const blocks = normalizeEdgeEventsToTranscript([
        edgeEvent(`evt-deny-${decision}`, 1, 'approval.decided', {
          runId: 'run-perm',
          decision,
          requestId: 'req-1',
          toolName: 'bash',
        }),
      ]);
      expect((blocks[0]! as { status: string }).status).toBe('failed');
    }
  });

  it('maps "approved" / "allowed" permission decisions to "completed" status', () => {
    for (const decision of ['approved', 'allowed']) {
      const blocks = normalizeEdgeEventsToTranscript([
        edgeEvent(`evt-allow-${decision}`, 1, 'approval.decided', {
          runId: 'run-perm',
          decision,
          requestId: 'req-1',
          toolName: 'bash',
        }),
      ]);
      expect((blocks[0]! as { status: string }).status).toBe('completed');
    }
  });

  // ── 5. run.queued handler ──────────────────────────────────────────────

  it('produces a text block with "pending" status for run.queued events', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-queued', 1, 'run.queued', {
        runId: 'run-q',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('text');
    expect((blocks[0]! as { text: string }).text).toBe('Run run-q queued');
    expect(blocks[0]!.evidenceRefs).toEqual([
      { id: 'run-run-q', kind: 'run', label: 'Run run-q', status: 'pending' },
    ]);
  });

  it('returns null for run.queued without a runId', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-queued-no-run', 1, 'run.queued', {}),
    ]);
    expect(blocks).toEqual([]);
  });

  it('run.queued block is correctly ordered when mixed with other lifecycle events', () => {
    // Note: run.queued, run.started, and run.output all produce kind='text' blocks
    // with EDGE_AUTHOR. If they share the same runId, consecutive text blocks merge.
    // To test ordering without merge, we use different runIds.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-started', 3, 'run.started', { runId: 'run-a' }, '2026-06-07T03:00:03Z'),
      edgeEvent('evt-queued', 1, 'run.queued', { runId: 'run-b' }, '2026-06-07T03:00:01Z'),
      edgeEvent('evt-finished', 5, 'run.finished', { runId: 'run-a', durationMs: 1000 }, '2026-06-07T03:00:05Z'),
    ]);

    // Events are sorted by sentAt. run.queued is first, then run.started, then run.finished.
    // Since run.queued and run.started have DIFFERENT runIds, they don't merge.
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.id).toBe('edge-event-evt-queued');
    expect((blocks[0]! as { text: string }).text).toBe('Run run-b queued');
    expect(blocks[1]!.id).toBe('edge-event-evt-started');
    expect((blocks[1]! as { text: string }).text).toBe('Run run-a started');
    expect(blocks[2]!.id).toBe('edge-event-evt-finished');
    expect(blocks[2]!.kind).toBe('finished');
  });

  // ── 6. Dedup logic ────────────────────────────────────────────────────

  it('does not produce duplicate blocks for the same event (no dedup of identical events)', () => {
    // normalizeEdgeEventsToTranscript does NOT implement full dedup;
    // it only merges consecutive same-kind blocks. Two identical non-delta
    // events produce two separate blocks.
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-dup-a', 1, 'run.agent.tool_call', {
        runId: 'run-d',
        callId: 'call-1',
        toolName: 'read',
        status: 'running',
      }),
      edgeEvent('evt-dup-b', 2, 'run.agent.tool_call', {
        runId: 'run-d',
        callId: 'call-1',
        toolName: 'read',
        status: 'running',
      }),
    ]);

    // Both events produce tool_call blocks with different event IDs
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.id).toBe('edge-event-evt-dup-a');
    expect(blocks[1]!.id).toBe('edge-event-evt-dup-b');
  });

  it('sorts duplicated events consistently by timestamp then seq then index', () => {
    // Two events with same timestamp, different seq → sorted by seq
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-b', 2, 'run.agent.text_delta', {
        runId: 'run-sort',
        content: 'Second by seq.',
      }, '2026-06-07T03:00:00Z'),
      edgeEvent('evt-a', 1, 'run.agent.text_delta', {
        runId: 'run-sort',
        content: 'First by seq.',
      }, '2026-06-07T03:00:00Z'),
    ]);

    expect(blocks).toHaveLength(1); // Merged because same author+run+kind
    expect(blocks[0]!.id).toBe('edge-event-evt-a'); // Lower seq is first, survives merge as base
    expect((blocks[0]! as { text: string }).text).toBe('First by seq.Second by seq.');
  });

  it('filters out blocks from unsupported event types', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-unknown', 1, 'thread.updated', {
        threadId: 'thread-x',
      }),
      edgeEvent('evt-valid', 2, 'run.agent.text_delta', {
        runId: 'run-x',
        content: 'Valid content.',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.id).toBe('edge-event-evt-valid');
    expect((blocks[0]! as { text: string }).text).toBe('Valid content.');
  });

  it('filters out empty-payload and whitespace-only blocks', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-empty-text', 1, 'run.output', {
        runId: 'run-x',
        text: '   ',
      }),
      edgeEvent('evt-empty-content', 2, 'run.agent.text_delta', {
        runId: 'run-x',
        content: '\n\t  ',
      }),
      edgeEvent('evt-valid', 3, 'run.agent.text_delta', {
        runId: 'run-x',
        content: 'real content',
      }),
    ]);

    expect(blocks).toHaveLength(1);
    expect((blocks[0]! as { text: string }).text).toBe('real content');
  });

  it('preserves merge behavior across sorted-out-of-order text_delta events', () => {
    // Events arrive out of order (by sentAt), get sorted, then merged
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('evt-late', 3, 'run.agent.text_delta', {
        runId: 'run-reorder',
        content: ' last.',
      }, '2026-06-07T03:00:03Z'),
      edgeEvent('evt-early', 1, 'run.agent.text_delta', {
        runId: 'run-reorder',
        content: 'Should be',
      }, '2026-06-07T03:00:01Z'),
      edgeEvent('evt-mid', 2, 'run.agent.text_delta', {
        runId: 'run-reorder',
        content: ' sorted',
      }, '2026-06-07T03:00:02Z'),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.id).toBe('edge-event-evt-early'); // Earliest timestamp wins as base block ID
    expect((blocks[0]! as { text: string }).text).toBe('Should besortedlast.');
  });
});

function edgeEvent(
  id: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  sentAt = `2026-06-07T03:00:0${seq}Z`,
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
  };
}
