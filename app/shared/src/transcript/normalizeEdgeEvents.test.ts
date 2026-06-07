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
        diff: '@@ -1 +1 @@',
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
        kind: 'diff',
        title: 'app/shared/src/transcript/normalizeEdgeEvents.ts',
        files: ['app/shared/src/transcript/normalizeEdgeEvents.ts'],
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
        kind: 'approval',
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
        id: 'edge-event-evt-finished',
        kind: 'text',
        text: 'Run run-live finished',
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
        isThinking: true,
      }),
      expect.objectContaining({
        kind: 'subagent',
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
