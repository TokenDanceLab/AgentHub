/* ═══════════════════════════════════════════════════════════════════════
   EDGE INTEGRATION TEST
   Feeds real Edge Server EventEnvelope streams through the PRODUCTION
   normalizeEdgeEventsToTranscript → TranscriptBlock[] → ChatView adapter.

   History: this file used to define its own in-test copy of a
   `normalizeEdgeEventsToTranscript` function and asserted against that
   mirror, so production regressions were invisible here. It now imports
   the production normalizer (./normalizeEdgeEvents) directly.
   ══════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest'
import type { EventEnvelope } from '../events'
import { blocksToTranscriptItems } from '../chatview/adapter'
import type { TranscriptAgentItem } from '../chatview/transcript-item'
import { normalizeEdgeEventsToTranscript } from './normalizeEdgeEvents'

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
  }
}

// ── Tests ──

describe('Edge event → TranscriptBlock normalization', () => {
  it('normalizes think events through lifecycle', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('e1', 1, 'run.agent.thinking', {
        runId: 'run-think',
        content: 'analyzing...',
        status: 'running',
      }),
      edgeEvent('e2', 2, 'run.agent.thinking', {
        runId: 'run-think',
        content: 'analysis done',
        status: 'completed',
      }),
    ])

    // Production merges consecutive same-author, same-run thinking deltas
    // into a single block, and auto-completes it once thinking ends.
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual(expect.objectContaining({
      kind: 'thinking',
      content: 'analyzing...analysis done',
      isThinking: false,
    }))
  })

  it('normalizes tool_call → tool_result pair', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('e1', 1, 'run.agent.tool_call', {
        runId: 'run-tools',
        callId: 'call-read',
        toolName: 'Read',
        status: 'running',
      }),
      edgeEvent('e2', 2, 'run.agent.tool_result', {
        runId: 'run-tools',
        callId: 'call-read',
        toolName: 'Read',
        summary: '42 lines',
      }),
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual(expect.objectContaining({
      kind: 'tool_call',
      toolName: 'Read',
      status: 'running',
    }))
    expect(blocks[1]).toEqual(expect.objectContaining({
      kind: 'tool_result',
      toolName: 'Read',
      status: 'completed',
      summary: '42 lines',
    }))
  })

  it('normalizes file_change with patch', () => {
    const patch = '@@ -1 +1 @@\n-old\n+new'
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('e1', 1, 'run.agent.file_change', {
        runId: 'run-file',
        path: 'src/user.ts',
        kind: 'modified',
        diff: patch,
      }),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual(expect.objectContaining({
      kind: 'file_change',
      path: 'src/user.ts',
      action: 'modified',
      additions: 1,
      deletions: 1,
      patch,
    }))
  })

  it('handles interleaved agents (Builder + Reviewer)', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('b1', 1, 'run.agent.thinking', {
        runId: 'team-run',
        agentId: 'builder',
        agentName: 'Builder',
        content: 'checking',
      }),
      edgeEvent('r1', 2, 'run.agent.thinking', {
        runId: 'team-run',
        agentId: 'reviewer',
        agentName: 'Reviewer',
        content: 'reviewing',
      }),
    ])

    // Different authors never merge, even within the same run.
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.author).toEqual({ id: 'builder', name: 'Builder', role: 'agent' })
    expect(blocks[1]!.author).toEqual({ id: 'reviewer', name: 'Reviewer', role: 'agent' })
    // Builder is still thinking while Reviewer's thinking streams behind it;
    // the trailing thinking block auto-completes.
    expect(blocks[0]).toEqual(expect.objectContaining({ kind: 'thinking', isThinking: true }))
    expect(blocks[1]).toEqual(expect.objectContaining({ kind: 'thinking', isThinking: false }))
  })

  it('round-trips through adapter without data loss', () => {
    const blocks = normalizeEdgeEventsToTranscript([
      edgeEvent('e1', 1, 'run.agent.thinking', {
        runId: 'run-rt',
        content: 'done',
        status: 'completed',
      }),
      edgeEvent('e2', 2, 'run.agent.tool_call', {
        runId: 'run-rt',
        callId: 'call-read',
        toolName: 'Read',
        status: 'running',
      }),
      edgeEvent('e3', 3, 'run.agent.tool_result', {
        runId: 'run-rt',
        callId: 'call-read',
        toolName: 'Read',
        summary: 'ok',
      }),
    ])
    expect(blocks).toHaveLength(3)

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1) // all same (default) agent author → grouped
    const agent = items[0] as TranscriptAgentItem
    expect(agent.rows).toHaveLength(2) // think + tool (result merged into tool_call row)
    expect(agent.rows[0]).toEqual(expect.objectContaining({ type: 'think' }))
    expect(agent.rows[1]).toEqual(expect.objectContaining({
      type: 'tool',
      label: 'Read',
      toolCallId: 'call-read',
      status: 'ok',
      isResult: true, // tool_result replaced the pending tool_call row
    }))
  })
})
