/* ═══════════════════════════════════════════════════════════════════════
   ADAPTER TESTS — blocksToTranscriptItems() contract validation
   ══════════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest'
import { blocksToTranscriptItems } from './adapter'
import type { TranscriptBlock } from '../transcript/types'

const B = (id: string, name = 'Builder') => ({ id, name, role: 'agent' as const })
const U = (id: string, name = 'Ding') => ({ id, name, role: 'human' as const })
const T = (offsetMin = 0) => new Date(Date.UTC(2026, 5, 17, 14, 30 + offsetMin)).toISOString()

describe('blocksToTranscriptItems', () => {
  it('returns empty array for empty input', () => {
    expect(blocksToTranscriptItems([])).toEqual([])
  })

  it('converts user text to UserTranscriptMsg', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', createdAt: T(0), author: U('ding'), text: 'hello' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'user', text: 'hello', name: 'Ding' })
  })

  it('groups consecutive agent blocks into single AgentTranscriptBlock', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'th1', kind: 'thinking', createdAt: T(1), author: B('b1'),
        content: 'thinking...', isThinking: true,
      },
      {
        id: 'tc1', kind: 'tool_call', createdAt: T(2), author: B('b1'),
        toolName: 'Read', status: 'running',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as any
    expect(agent.rows).toHaveLength(2)
    expect(agent.rows[0].type).toBe('think')
    expect(agent.rows[1].type).toBe('tool')
  })

  it('splits different agents into separate blocks', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'th1', kind: 'thinking', createdAt: T(1), author: B('b1'),
        content: 'a', isThinking: true,
      },
      {
        id: 'th2', kind: 'thinking', createdAt: T(2), author: { id: 'r1', name: 'Reviewer', role: 'agent' },
        content: 'b', isThinking: true,
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(2)
    expect((items[0] as any).agent).toBe('Builder')
    expect((items[1] as any).agent).toBe('Reviewer')
  })

  it('maps thinking block to think RowItem', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: T(1), author: B('b1'), content: 'analyzing...', isThinking: true },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as any).rows[0]
    expect(row.type).toBe('think')
    expect(row.status).toBe('running')
    expect(row.content).toBe('analyzing...')
  })

  it('maps tool_call + tool_result pair', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: T(1), author: B('b1'), toolName: 'Read', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: T(2), author: B('b1'), toolName: 'Read', status: 'completed', summary: 'found 42 lines' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as any).rows
    expect(rows[0].type).toBe('tool')
    expect(rows[0].status).toBe('running')
    expect(rows[1].type).toBe('tool')
    expect(rows[1].status).toBe('ok')
    expect(rows[1].isResult).toBe(true)
  })

  it('maps file_change with patch to diffLines', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'fc1', kind: 'file_change', createdAt: T(1), author: B('b1'),
        path: 'src/models/user.ts', action: 'modified', additions: 2, deletions: 1,
        patch: '- old line\n+ new line',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as any).rows[0]
    expect(row.type).toBe('file')
    expect(row.fileOp).toBe('mod')
    expect(row.diffLines).toHaveLength(2)
  })

  it('maps approval to standalone RowItem', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'ap1', kind: 'approval', createdAt: T(1), author: B('b1'), title: 'Deploy approval', status: 'pending', reason: 'needs review' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as any).standaloneRows
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('approval')
    expect(rows[0].status).toBe('waiting')
  })

  it('skips result/finished/replay_gap blocks', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'r1', kind: 'result', createdAt: T(1), author: B('b1'), success: true },
      { id: 'r2', kind: 'finished', createdAt: T(2), author: B('b1'), title: 'done', runId: 'r1' },
      { id: 'r3', kind: 'replay_gap', createdAt: T(3), author: B('b1'), replayedCount: 5 },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(0)
  })

  it('flattens run_step_group children', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'rsg1', kind: 'run_step_group', createdAt: T(1), author: B('b1'),
        icon: '>', title: 'Commands', status: 'completed', open: true,
        children: [
          { id: 'tc1', kind: 'tool_call', author: B('b1'), toolName: 'Read', status: 'running' } as TranscriptBlock,
        ] as TranscriptBlock[],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as any).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('tool')
  })

  it('handles user message between agent blocks', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', createdAt: T(0), author: U('ding'), text: 'do X' },
      { id: 'th1', kind: 'thinking', createdAt: T(1), author: B('b1'), content: 'ok', isThinking: true },
      { id: 'u2', kind: 'text', createdAt: T(2), author: U('ding'), text: 'also do Y' },
      { id: 'tc1', kind: 'tool_call', createdAt: T(3), author: B('b1'), toolName: 'Write', status: 'running' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(4) // user, agent, user, agent
    expect(items[0]).toMatchObject({ type: 'user' })
    expect((items[1] as any).rows).toHaveLength(1)
    expect(items[2]).toMatchObject({ type: 'user' })
    expect((items[3] as any).rows).toHaveLength(1)
  })
})
