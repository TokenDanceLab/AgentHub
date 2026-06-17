/* ═══════════════════════════════════════════════════════════════════════
   ADAPTER TESTS — blocksToTranscriptItems() contract validation
   ══════════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest'
import { blocksToTranscriptItems, type AgentTranscriptBlock } from './adapter'
import type { TranscriptBlock } from '../transcript/types'

const DEFAULT_AGENT_NAME = 'TestAgent'
const DEFAULT_USER_NAME = 'User'

const makeAuthor = (id: string, name = DEFAULT_AGENT_NAME) => ({ id, name, role: 'agent' as const })
const makeUser = (id: string, name = DEFAULT_USER_NAME) => ({ id, name, role: 'human' as const })
const makeTime = (offsetMin = 0) => new Date(Date.UTC(2026, 5, 17, 14, 30 + offsetMin)).toISOString()

describe('blocksToTranscriptItems', () => {
  it('returns empty array for empty input', () => {
    expect(blocksToTranscriptItems([])).toEqual([])
  })

  it('converts user text to TranscriptUserItem', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', createdAt: makeTime(0), author: makeUser('ding'), text: 'hello' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'user', text: 'hello', name: DEFAULT_USER_NAME })
  })

  it('groups consecutive agent blocks into single AgentTranscriptBlock', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'thinking...', isThinking: true },
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items.length).toBe(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.rows.length).toBe(2)
    expect(agent.rows[0]!.type).toBe('think')
    expect(agent.rows[1]!.type).toBe('tool')
  })

  it('splits different agents into separate blocks', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'),
        content: 'a', isThinking: true,
      },
      {
        id: 'th2', kind: 'thinking', createdAt: makeTime(2), author: { id: 'r1', name: 'ReviewerAgent', role: 'agent' },
        content: 'b', isThinking: true,
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(2)
    expect((items[0] as AgentTranscriptBlock).agent).toBe(DEFAULT_AGENT_NAME)
    expect((items[1] as AgentTranscriptBlock).agent).toBe('ReviewerAgent')
  })

  it('maps thinking block to think RowItem', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'analyzing...', isThinking: true },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('think')
    expect(row.status).toBe('running')
    expect(row.content).toBe('analyzing...')
  })

  it('maps tool_call + tool_result pair', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'found 42 lines' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows
    // tool_result merges with tool_call (same toolName) -> 1 card, status transitions to ok
    expect(rows!.length).toBe(1)
    expect(rows![0]!.type).toBe('tool')
    expect(rows![0]!.status).toBe('ok')
    expect(rows![0]!.isResult).toBe(true)
  })

  it('maps file_change with patch to diffLines', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'fc1', kind: 'file_change', createdAt: makeTime(1), author: makeAuthor('b1'),
        path: 'src/models/user.ts', action: 'modified', additions: 2, deletions: 1,
        patch: '- old line\n+ new line',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('file')
    expect(row.fileOp).toBe('mod')
    expect(row.diffLines).toHaveLength(2)
  })

  it('maps approval to standalone RowItem', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'ap1', kind: 'approval', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'Deploy approval', status: 'pending', reason: 'needs review' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).standaloneRows
    expect(rows).toHaveLength(1)
    expect(rows![0]!.type).toBe('approval')
    expect(rows![0]!.status).toBe('waiting')
  })

  it('skips result/finished/replay_gap blocks', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'r1', kind: 'result', createdAt: makeTime(1), author: makeAuthor('b1'), success: true },
      { id: 'r2', kind: 'finished', createdAt: makeTime(2), author: makeAuthor('b1'), title: 'done', runId: 'r1' },
      { id: 'r3', kind: 'replay_gap', createdAt: makeTime(3), author: makeAuthor('b1'), replayedCount: 5 },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(0)
  })

  it('flattens run_step_group children', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'rsg1', kind: 'run_step_group', createdAt: makeTime(1), author: makeAuthor('b1'),
        icon: '>', title: 'Commands', status: 'completed', open: true,
        children: [
          { id: 'tc1', kind: 'tool_call', author: makeAuthor('b1'), toolName: 'Read', status: 'running' } as TranscriptBlock,
        ] as TranscriptBlock[],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows
    expect(rows).toHaveLength(1)
    expect(rows![0]!.type).toBe('tool')
  })

  it('handles user message between agent blocks', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', createdAt: makeTime(0), author: makeUser('ding'), text: 'do X' },
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'ok', isThinking: true },
      { id: 'u2', kind: 'text', createdAt: makeTime(2), author: makeUser('ding'), text: 'also do Y' },
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(3), author: makeAuthor('b1'), toolName: 'Write', status: 'running' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(4) // user, agent, user, agent
    expect(items[0]).toMatchObject({ type: 'user' })
    expect((items[1] as AgentTranscriptBlock).rows).toHaveLength(1)
    expect(items[2]).toMatchObject({ type: 'user' })
    expect((items[3] as AgentTranscriptBlock).rows).toHaveLength(1)
  })
})
