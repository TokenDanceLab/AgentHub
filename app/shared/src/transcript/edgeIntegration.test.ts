/* ═══════════════════════════════════════════════════════════════════════
   EDGE INTEGRATION TEST HARNESS
   simulates Edge Server event stream → TranscriptBlock[] → ChatView
   ══════════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest'
import type { TranscriptBlock } from '../transcript/types'

/**
 * Simulates Edge Server event stream pattern.
 * Edge emits: think events → tool events → artifact events → result events
 * Each event has a status (pending → running → completed/failed)
 */
interface EdgeEvent {
  id: string
  type: 'think' | 'tool_call' | 'tool_result' | 'file_change' | 'approval' | 'result'
  status: 'pending' | 'running' | 'completed' | 'failed'
  agentId: string
  agentName: string
  timestamp: string
  meta?: Record<string, unknown>
}

/**
 * Normalizes Edge events into TranscriptBlock[] format.
 * This mirrors what normalizeHubMessagesToTranscript does for Hub messages.
 */
function normalizeEdgeEventsToTranscript(events: EdgeEvent[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []

  for (const event of events) {
    const author = { id: event.agentId, name: event.agentName, role: 'agent' as const }

    switch (event.type) {
      case 'think':
        blocks.push({
          id: event.id, kind: 'thinking', createdAt: event.timestamp, author,
          content: (event.meta?.content as string) || '',
          isThinking: event.status === 'running' || event.status === 'pending',
        } as TranscriptBlock)
        break

      case 'tool_call':
        blocks.push({
          id: event.id, kind: 'tool_call', createdAt: event.timestamp, author,
          toolName: (event.meta?.toolName as string) || 'unknown',
          status: event.status as 'pending' | 'running' | 'completed' | 'failed',
          target: event.meta?.target as string | undefined,
          summary: event.meta?.summary as string | undefined,
        } as TranscriptBlock)
        break

      case 'tool_result':
        blocks.push({
          id: event.id, kind: 'tool_result', createdAt: event.timestamp, author,
          toolName: (event.meta?.toolName as string) || 'unknown',
          status: event.status,
          summary: event.meta?.summary as string | undefined,
        } as TranscriptBlock)
        break

      case 'file_change':
        blocks.push({
          id: event.id, kind: 'file_change', createdAt: event.timestamp, author,
          path: (event.meta?.path as string) || '',
          action: (event.meta?.action as 'created' | 'modified' | 'deleted') || 'modified',
          additions: event.meta?.additions as number | undefined,
          deletions: event.meta?.deletions as number | undefined,
          patch: event.meta?.patch as string | undefined,
        } as TranscriptBlock)
        break

      case 'approval':
        blocks.push({
          id: event.id, kind: 'approval', createdAt: event.timestamp, author,
          title: (event.meta?.title as string) || 'Approval',
          status: event.status,
          reason: event.meta?.reason as string | undefined,
        } as TranscriptBlock)
        break

      case 'result':
        blocks.push({
          id: event.id, kind: 'result', createdAt: event.timestamp, author,
          success: event.status !== 'failed',
          duration: event.meta?.duration as string | undefined,
        } as TranscriptBlock)
        break
    }
  }

  return blocks
}

// ── Tests ──

describe('Edge event → TranscriptBlock normalization', () => {
  it('normalizes think events through lifecycle', () => {
    const events: EdgeEvent[] = [
      { id: 'e1', type: 'think', status: 'running', agentId: 'a1', agentName: 'Builder', timestamp: new Date().toISOString(), meta: { content: 'analyzing...' } },
      { id: 'e2', type: 'think', status: 'completed', agentId: 'a1', agentName: 'Builder', timestamp: new Date().toISOString(), meta: { content: 'analysis done' } },
    ]
    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks).toHaveLength(2)
    expect((blocks[0]! as any).isThinking).toBe(true)
    expect((blocks[1]! as any).isThinking).toBe(false)
  })

  it('normalizes tool_call → tool_result pair', () => {
    const events: EdgeEvent[] = [
      { id: 'e1', type: 'tool_call', status: 'running', agentId: 'a1', agentName: 'Builder', timestamp: new Date().toISOString(), meta: { toolName: 'Read' } },
      { id: 'e2', type: 'tool_result', status: 'completed', agentId: 'a1', agentName: 'Builder', timestamp: new Date().toISOString(), meta: { toolName: 'Read', summary: '42 lines' } },
    ]
    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks[0]!.kind).toBe('tool_call')
    expect(blocks[1]!.kind).toBe('tool_result')
  })

  it('normalizes file_change with patch', () => {
    const events: EdgeEvent[] = [
      { id: 'e1', type: 'file_change', status: 'completed', agentId: 'a1', agentName: 'Builder', timestamp: new Date().toISOString(), meta: { path: 'src/user.ts', action: 'modified', additions: 5, deletions: 3, patch: '- old\n+ new' } },
    ]
    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks[0]!.kind).toBe('file_change')
    const fc = blocks[0] as any
    expect(fc.path).toBe('src/user.ts')
    expect(fc.patch).toBe('- old\n+ new')
  })

  it('handles interleaved agents (Builder + Reviewer)', () => {
    const events: EdgeEvent[] = [
      { id: 'b1', type: 'think', status: 'running', agentId: 'builder', agentName: 'Builder', timestamp: new Date().toISOString(), meta: { content: 'checking' } },
      { id: 'r1', type: 'think', status: 'running', agentId: 'reviewer', agentName: 'Reviewer', timestamp: new Date().toISOString(), meta: { content: 'reviewing' } },
    ]
    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks[0]!.author!.name).toBe('Builder')
    expect(blocks[1]!.author!.name).toBe('Reviewer')
  })

  it('round-trips through adapter without data loss', async () => {
    const { blocksToTranscriptItems } = await import('../chatview/adapter')
    const events: EdgeEvent[] = [
      { id: 'e1', type: 'think', status: 'completed', agentId: 'a1', agentName: 'Builder', timestamp: new Date().toISOString(), meta: { content: 'done' } },
      { id: 'e2', type: 'tool_call', status: 'running', agentId: 'a1', agentName: 'Builder', timestamp: new Date().toISOString(), meta: { toolName: 'Read' } },
      { id: 'e3', type: 'tool_result', status: 'completed', agentId: 'a1', agentName: 'Builder', timestamp: new Date().toISOString(), meta: { toolName: 'Read', summary: 'ok' } },
    ]
    const blocks = normalizeEdgeEventsToTranscript(events)
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1) // all same agent → grouped
    const agent = items[0] as any
    expect(agent.rows).toHaveLength(3) // think + tool_call + tool_result
  })
})
