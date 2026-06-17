/* ═══════════════════════════════════════════════════════════════════════
   REAL EDGE ROUNDTRIP TEST — EventEnvelope → normalize → TranscriptBlock → ChatView
   ══════════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest'
import type { EventEnvelope } from '../events'
import { normalizeEdgeEventsToTranscript } from './normalizeEdgeEvents'
import { blocksToTranscriptItems } from '../chatview/adapter'

/** Build a realistic Edge EventEnvelope matching api/events.md contract */
function ev(id: string, seq: number, type: string, payload: Record<string, unknown>, scope: Record<string, unknown> = {}): EventEnvelope {
  return {
    version: '1.0', id, seq, type,
    scope: { threadId: 'thread-1', runId: 'run-1', ...scope },
    sentAt: new Date().toISOString(),
    payload,
  }
}

describe('Edge EventEnvelope → TranscriptBlock → ChatView roundtrip', () => {
  it('normalizes a complete agent ReAct cycle', () => {
    const events: EventEnvelope[] = [
      ev('e1', 1, 'run.agent.thinking', { content: 'Analyzing...', is_thinking: true }),
      ev('e2', 2, 'run.agent.tool_call', { toolName: 'Read', status: 'running' }),
      ev('e3', 3, 'run.agent.tool_result', { toolName: 'Read', summary: '142 lines', status: 'completed' }),
      ev('e4', 4, 'run.agent.tool_call', { toolName: 'Grep', status: 'running' }),
      ev('e5', 5, 'run.agent.tool_result', { toolName: 'Grep', summary: '12 matches across 5 files', status: 'completed' }),
      ev('e6', 6, 'run.agent.file_change', { path: 'migrations/003.sql', action: 'created', additions: 2 }),
      ev('e7', 7, 'run.agent.result', { success: true, summary: 'Done.' }),
    ]
    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks.length).toBeGreaterThanOrEqual(5)
    const items = blocksToTranscriptItems(blocks)
    expect(items.length).toBeGreaterThanOrEqual(1)
    const agent = items[0] as any
    expect(agent.rows.length).toBeGreaterThanOrEqual(4)
  })

  it('handles run lifecycle events', () => {
    const events: EventEnvelope[] = [
      ev('e1', 1, 'run.started', { run_id: 'run-1' }),
      ev('e2', 2, 'run.agent.text_delta', { text: 'Working on it...' }),
      ev('e3', 3, 'run.agent.text_delta', { text: 'Almost done.' }),
      ev('e4', 4, 'run.finished', { run_id: 'run-1', duration_ms: 4200 }),
    ]
    const blocks = normalizeEdgeEventsToTranscript(events)
    const items = blocksToTranscriptItems(blocks)
    expect(items.length).toBeGreaterThanOrEqual(1)
  })

  it('handles permission/approval flow', () => {
    const events: EventEnvelope[] = [
      ev('e1', 1, 'run.agent.permission_requested', {
        tool_name: 'Write',
        risk: 'medium',
        reason: 'Modifies src/models/user.ts',
      }),
      ev('e2', 2, 'run.agent.permission_decided', {
        tool_name: 'Write',
        decision: 'allowed',
        reason: 'Approved by user',
      }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    const items = blocksToTranscriptItems(blocks)
    expect(items.length).toBeGreaterThanOrEqual(1)
  })

  it('handles interleaved multi-agent events', () => {
    const events: EventEnvelope[] = [
      ev('e1', 1, 'run.agent.thinking', { content: 'Builder analyzing...', is_thinking: true }, { runId: 'run-builder' }),
      ev('e2', 2, 'run.agent.thinking', { content: 'Reviewer checking...', is_thinking: true }, { runId: 'run-reviewer' }),
      ev('e3', 3, 'run.agent.tool_call', { tool_name: 'Read', status: 'running' }, { runId: 'run-builder' }),
      ev('e4', 4, 'run.agent.tool_result', { tool_name: 'Read', status: 'completed', tool_output: 'ok' }, { runId: 'run-builder' }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    const items = blocksToTranscriptItems(blocks)
    expect(items.length).toBeGreaterThanOrEqual(1)
  })
})
