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
      ev('e2', 2, 'run.agent.thinking', { content: 'analyzing...' }),
      ev('e3', 3, 'run.agent.tool_call', { toolName: 'Read', status: 'running' }),
      ev('e4', 4, 'run.agent.tool_result', { toolName: 'Read', status: 'completed', summary: '42 lines' }),
      ev('e5', 5, 'run.agent.file_change', { path: 'src/user.ts', action: 'modified', additions: 2 }),
    ]

    const snapshots = simulateEdgeStream(stream)
    expect(snapshots.length).toBe(4)

    // After first think event: 1 agent with 1 row
    expect(snapshots[0]!.length).toBe(1)
    // Final: all events → 1 agent with 3 rows (thinking, tool result merged into tool call, file)
    const final = snapshots[3]!
    expect(final.length).toBe(1)
    const agent = final[0] as any
    expect(agent.rows.length).toBe(3)
  })

  it('streaming: agent IDs remain stable across WS events', () => {
    const stream: EventEnvelope[] = [
      ev('e1', 1, 'run.agent.thinking', { content: 'a' }),
      ev('e2', 2, 'run.agent.tool_call', { toolName: 'Read', status: 'running' }),
      ev('e3', 3, 'run.agent.tool_result', { toolName: 'Read', status: 'completed', summary: 'ok' }),
    ]
    const snapshots = simulateEdgeStream(stream)
    // Snapshots: [thinking], [thinking, tool_call], [thinking, tool_merged]
    // After snapshot 2 (tool_result merges into tool_call), row count stays at 2
    expect(snapshots[0]!.length).toBe(1)
    expect((snapshots[0]![0] as any).rows.length).toBe(1)
    expect(snapshots[1]!.length).toBe(1)
    expect((snapshots[1]![0] as any).rows.length).toBe(2)
    // Final: tool_result merged into tool_call, so still 2 rows
    expect(snapshots[2]!.length).toBe(1)
    expect((snapshots[2]![0] as any).rows.length).toBe(2)
  })

  it('streaming: interleaved runs do NOT merge thinking blocks from different runs', () => {
    // Thinking blocks from different runs should remain separate
    // because evidenceRunId differs between them
    const stream: EventEnvelope[] = [
      ev('b1', 1, 'run.agent.thinking', { content: 'Builder...' }, { runId: 'rb' }),
      ev('r1', 2, 'run.agent.thinking', { content: 'Reviewer...' }, { runId: 'rr' }),
      ev('b2', 3, 'run.agent.tool_call', { toolName: 'Read', status: 'running' }, { runId: 'rb' }),
    ]
    const snapshots = simulateEdgeStream(stream)
    const final = snapshots[2]!
    expect(final.length).toBe(1) // all same AGENT_AUTHOR → one group
    // 3 rows: Builder thinking, Reviewer thinking, Read tool_call (no merges across runs)
    expect((final[0] as any).rows.length).toBe(3)
  })
})
