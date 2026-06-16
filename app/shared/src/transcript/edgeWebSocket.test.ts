/* ═══════════════════════════════════════════════════════════════════════
   WEBSOCKET STREAMING INTEGRATION TEST
   Simulates real Edge WS event stream pattern — incremental block arrival
   through normalizeEdgeEvents → blocksToTranscriptItems → ChatView render.
   ══════════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest'
import { normalizeEdgeEventsToTranscript } from './normalizeEdgeEvents'
import { blocksToTranscriptItems } from '../chatview/adapter'
import type { EventEnvelope } from '../events'

// ── Edge WS streaming pattern: events arrive incrementally ──
// Real Edge WS behavior: events pushed one-by-one via WebSocket.
// The desktop useDesktopEdgeEvents hook accumulates them in React state
// and passes the growing TranscriptBlock[] to AgentHubWorkbench.

function simulateEdgeStream(events: EventEnvelope[]): ReturnType<typeof blocksToTranscriptItems>[] {
  const snapshots: ReturnType<typeof blocksToTranscriptItems>[] = []
  const accumulated: EventEnvelope[] = []
  for (const evt of events) {
    accumulated.push(evt)
    const blocks = normalizeEdgeEventsToTranscript([...accumulated])
    snapshots.push(blocksToTranscriptItems(blocks))
  }
  return snapshots
}

function ev(id: string, seq: number, type: string, payload: Record<string, unknown>, scope: Record<string, unknown> = {}): EventEnvelope {
  return { version: '1.0', id, seq, type, scope: { threadId: 't1', runId: 'r1', ...scope }, sentAt: new Date().toISOString(), payload }
}

describe('Edge WebSocket streaming → ChatView', () => {
  it('streaming: agent blocks accumulate incrementally', () => {
    const stream: EventEnvelope[] = [
      ev('e2', 2, 'run.agent.thinking', { content: 'analyzing...', is_thinking: true }),
      ev('e3', 3, 'run.agent.thinking', { content: 'analyzed.', is_thinking: false }),
      ev('e4', 4, 'run.agent.tool_call', { toolName: 'Read', status: 'running' }),
      ev('e5', 5, 'run.agent.tool_result', { toolName: 'Read', status: 'completed', summary: '42 lines' }),
      ev('e6', 6, 'run.agent.file_change', { path: 'src/user.ts', action: 'modified', additions: 2 }),
    ]

    const snapshots = simulateEdgeStream(stream)
    expect(snapshots.length).toBe(5)

    // After first think event: 1 agent with 1 row
    expect(snapshots[0]!.length).toBe(1)
    // Final: all events → 1 agent (same AGENT_AUTHOR) with 5 rows (result skipped by adapter)
    const final = snapshots[4]!
    expect(final.length).toBe(1)
    const agent = final[0] as any
    expect(agent.rows.length).toBe(5)
  })

  it('streaming: agent IDs remain stable across WS events', () => {
    const stream: EventEnvelope[] = [
      ev('e1', 1, 'run.agent.thinking', { content: 'a', is_thinking: true }),
      ev('e2', 2, 'run.agent.tool_call', { toolName: 'Read', status: 'running' }),
      ev('e3', 3, 'run.agent.tool_result', { toolName: 'Read', status: 'completed', summary: 'ok' }),
    ]
    const snapshots = simulateEdgeStream(stream)
    // All snapshots: single agent with growing rows
    for (let i = 0; i < snapshots.length; i++) {
      const items = snapshots[i]!
      expect(items.length).toBe(1)
      expect((items[0] as any).rows.length).toBe(i + 1)
    }
  })

  it('streaming: interleaved runs merge under same AGENT_AUTHOR', () => {
    // All AGENT_AUTHOR blocks share id='agent' — they group into one AgentTranscriptBlock
    const stream: EventEnvelope[] = [
      ev('b1', 1, 'run.agent.thinking', { content: 'Builder...', is_thinking: true }, { runId: 'rb' }),
      ev('r1', 2, 'run.agent.thinking', { content: 'Reviewer...', is_thinking: true }, { runId: 'rr' }),
      ev('b2', 3, 'run.agent.tool_call', { toolName: 'Read', status: 'running' }, { runId: 'rb' }),
    ]
    const snapshots = simulateEdgeStream(stream)
    const final = snapshots[2]!
    expect(final.length).toBe(1) // all same AGENT_AUTHOR → one group with 3 rows
    expect((final[0] as any).rows.length).toBe(3)
  })
})
