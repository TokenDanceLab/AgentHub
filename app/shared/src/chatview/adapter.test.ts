// real_tested=true
import { describe, it, expect } from 'vitest'

import {
  blocksToTranscriptItems,
  resolveCompactDividerIndices,
  resolveUnreadAnchorItemIndex,
  SEP,
} from './adapter'
import type { AgentTranscriptBlock, TranscriptUserItem } from './index'
import type { TranscriptBlock } from '../transcript/types'
import {
  makeAuthor,
  makeUser,
  makeTime,
  DEFAULT_AGENT_NAME,
  DEFAULT_USER_NAME,
} from './adapter-test-helpers'

const makeSystemAuthor = (id: string, name = 'System') => ({ id, name, role: 'system' as const })

describe('SEP re-export', () => {
  it('re-exports the display separator constant', () => {
    expect(SEP).toBe(' · ')
  })
})

describe('blocksToTranscriptItems — user messages', () => {
  it('returns an empty array for empty input', () => {
    expect(blocksToTranscriptItems([])).toEqual([])
  })

  it('converts a user text block into a TranscriptUserItem', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', createdAt: makeTime(0), author: makeUser('alice'), text: 'hello' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const item = items[0] as TranscriptUserItem
    expect(item.type).toBe('user')
    expect(item.id).toBe('u1')
    expect(item.name).toBe(DEFAULT_USER_NAME)
    expect(item.text).toBe('hello')
    expect(item.time).toBeTruthy()
    expect(item.time).toMatch(/\d{1,2}:\d{2}/)
  })

  it('produces an empty time string when createdAt is missing', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', author: makeUser('alice'), text: 'hello' },
    ]
    const item = blocksToTranscriptItems(blocks)[0] as TranscriptUserItem
    expect(item.time).toBe('')
  })

  it('propagates display overrides onto the user item', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'u1', kind: 'text', author: makeUser('alice'), text: 'hello',
        displayTitle: 'T', displayDetail: 'D', badgeLabel: 'B', badgeVariant: 'thinking',
      },
    ]
    const item = blocksToTranscriptItems(blocks)[0] as TranscriptUserItem
    expect(item.displayTitle).toBe('T')
    expect(item.displayDetail).toBe('D')
    expect(item.badgeLabel).toBe('B')
    expect(item.badgeVariant).toBe('thinking')
  })

  it('omits display override keys when the block has none', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', author: makeUser('alice'), text: 'hello' },
    ]
    const item = blocksToTranscriptItems(blocks)[0] as TranscriptUserItem
    expect(item.displayTitle).toBeUndefined()
    expect(item.displayDetail).toBeUndefined()
    expect(item.badgeLabel).toBeUndefined()
    expect(item.badgeVariant).toBeUndefined()
  })

  it('produces one item per user text block', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', createdAt: makeTime(0), author: makeUser('alice'), text: 'a' },
      { id: 'u2', kind: 'text', createdAt: makeTime(1), author: makeUser('alice'), text: 'b' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(2)
    expect((items[0] as TranscriptUserItem).text).toBe('a')
    expect((items[1] as TranscriptUserItem).text).toBe('b')
  })

  // #1957: the sender's own uploads must render inline in the transcript —
  // human attachment blocks keep their contentType and ride a user item.
  it('converts a human image attachment block into a user item with an image row (#1957)', () => {
    const attachmentRef = { id: 'att-1', name: 'photo.png', size: 2048, mime_type: 'image/png' }
    const blocks: TranscriptBlock[] = [
      {
        id: 'h1', kind: 'attachment', createdAt: makeTime(0), author: makeUser('alice'),
        attachmentRef, contentType: 'image',
      },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const item = items[0] as TranscriptUserItem
    expect(item.type).toBe('user')
    expect(item.id).toBe('h1')
    expect(item.name).toBe(DEFAULT_USER_NAME)
    expect(item.time).toBeTruthy()
    // Attachment-only items carry empty text; the row keeps the image marker
    // and ref so the renderer can resolve a thumbnail through the port.
    expect(item.text).toBe('')
    expect(item.attachments).toHaveLength(1)
    const row = item.attachments?.[0]
    expect(row).toMatchObject({
      id: 'h1', type: 'attachment',
      attachmentKind: 'image', attachmentRef,
      fileName: 'photo.png', fileSize: '2 KB',
    })
  })

  it('converts a human file attachment block into a user item with a chip row (#1957)', () => {
    const attachmentRef = { id: 'att-2', name: 'notes.md', size: 1536, mime_type: 'text/markdown' }
    const blocks: TranscriptBlock[] = [
      {
        id: 'h1', kind: 'attachment', createdAt: makeTime(0), author: makeUser('alice'),
        attachmentRef, contentType: 'file',
      },
    ]
    const item = blocksToTranscriptItems(blocks)[0] as TranscriptUserItem
    expect(item.type).toBe('user')
    expect(item.text).toBe('')
    expect(item.attachments).toHaveLength(1)
    expect(item.attachments?.[0]).toMatchObject({
      type: 'attachment', attachmentKind: 'file', attachmentRef,
      fileName: 'notes.md', fileSize: '2 KB',
    })
  })

  it('omits the attachments key for text-only user items (#1957)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', createdAt: makeTime(0), author: makeUser('alice'), text: 'hello' },
    ]
    const item = blocksToTranscriptItems(blocks)[0] as TranscriptUserItem
    expect(item.attachments).toBeUndefined()
  })

  it('flushes a pending agent group before a human attachment item (#1957)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'x', isThinking: true },
      {
        id: 'h1', kind: 'attachment', createdAt: makeTime(2), author: makeUser('alice'),
        attachmentRef: { id: 'att-1', name: 'photo.png', size: 2048, mime_type: 'image/png' },
        contentType: 'image',
      },
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(3), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ agent: DEFAULT_AGENT_NAME })
    expect((items[1] as TranscriptUserItem).type).toBe('user')
    expect((items[1] as TranscriptUserItem).attachments).toHaveLength(1)
    expect(items[2]).toMatchObject({ agent: DEFAULT_AGENT_NAME })
  })

  it('flushes a pending agent item before pushing a user item', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'x', isThinking: true },
      { id: 'u1', kind: 'text', createdAt: makeTime(2), author: makeUser('alice'), text: 'stop' },
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(3), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ agent: DEFAULT_AGENT_NAME })
    expect(items[1]).toMatchObject({ type: 'user' })
    expect(items[2]).toMatchObject({ agent: DEFAULT_AGENT_NAME })
    expect((items[2] as AgentTranscriptBlock).id).toBe('b1-3')
  })

  it('keeps the undefined text value when a user text block lacks text', () => {
    const blocks = [
      { id: 'u1', kind: 'text' as const, author: makeUser('alice'), text: undefined as unknown as string },
    ] as TranscriptBlock[]
    const item = blocksToTranscriptItems(blocks)[0] as TranscriptUserItem
    expect(item.type).toBe('user')
    expect(item.text).toBeUndefined()
  })
})

describe('blocksToTranscriptItems — agent text bubbles and grouping', () => {
  it('converts a single agent text block into an agent item with one bubble', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'a1', kind: 'text', createdAt: makeTime(0), author: makeAuthor('b1'), text: 'hello' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.agent).toBe(DEFAULT_AGENT_NAME)
    expect(agent.role).toBe('agent')
    expect(agent.groupId).toBe('b1')
    expect(agent.id).toBe('b1-1') // `${author.id}-${seq}` React key scheme
    expect(agent.bubbles).toEqual(['hello'])
    expect(agent.rows).toEqual([])
    expect(agent.time).toBeTruthy()
  })

  it('derives the agent id seq from the absolute block position', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', createdAt: makeTime(0), author: makeUser('alice'), text: 'q' },
      { id: 'a1', kind: 'text', createdAt: makeTime(1), author: makeAuthor('b1'), text: 'reply' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect((items[1] as AgentTranscriptBlock).id).toBe('b1-2')
  })

  it('merges consecutive same-author text blocks into one item', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'a1', kind: 'text', createdAt: makeTime(1), author: makeAuthor('b1'), text: 'first' },
      { id: 'a2', kind: 'text', createdAt: makeTime(2), author: makeAuthor('b1'), text: 'second' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.bubbles).toEqual(['first', 'second'])
    expect(agent.parts).toHaveLength(2)
    expect(agent.parts![0]).toMatchObject({ type: 'bubble', text: 'first' })
    expect(agent.parts![1]).toMatchObject({ type: 'bubble', text: 'second' })
    // #1821: each bubble part carries its upstream block id so the rendered
    // bubble can expose the same selectable/context-menu identity tool rows have.
    expect(agent.parts![0]).toMatchObject({ blockId: 'a1' })
    expect(agent.parts![1]).toMatchObject({ blockId: 'a2' })
  })

  it('creates the agent item for an empty text block but pushes no bubble', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'a1', kind: 'text', createdAt: makeTime(1), author: makeAuthor('b1'), text: '' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.bubbles).toEqual([])
    expect(agent.parts).toEqual([])
  })

  it('applies display overrides only from the first block of a merged group', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'a1', kind: 'text', createdAt: makeTime(1), author: makeAuthor('b1'), text: 'first', displayTitle: 'first-title' },
      { id: 'a2', kind: 'text', createdAt: makeTime(2), author: makeAuthor('b1'), text: 'second', displayTitle: 'second-title' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.displayTitle).toBe('first-title')
  })

  it('maps reply-to metadata from the first text block onto the agent item', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'a1', kind: 'text', createdAt: makeTime(1), author: makeAuthor('b1'),
        text: 'hi', replyToMessageId: 'm0', replyAuthor: 'alice', replyPreview: 'original message',
      },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.replyBlockId).toBe('m0')
    expect(agent.replyAuthor).toBe('alice')
    expect(agent.replyPreview).toBe('original message')
  })

  it('keeps the reply metadata of the first reply-bearing block', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'a1', kind: 'text', createdAt: makeTime(1), author: makeAuthor('b1'), text: 'hi', replyToMessageId: 'm0', replyAuthor: 'alice' },
      { id: 'a2', kind: 'text', createdAt: makeTime(2), author: makeAuthor('b1'), text: 'again', replyToMessageId: 'm9', replyAuthor: 'bob' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.replyBlockId).toBe('m0')
    expect(agent.replyAuthor).toBe('alice')
  })

  it('omits replyAuthor and replyPreview when they are undefined', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'a1', kind: 'text', createdAt: makeTime(1), author: makeAuthor('b1'), text: 'hi', replyToMessageId: 'm0' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.replyBlockId).toBe('m0')
    expect(agent.replyAuthor).toBeUndefined()
    expect(agent.replyPreview).toBeUndefined()
  })

  it('takes reply metadata from a later block when earlier blocks lack it', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'a1', kind: 'text', createdAt: makeTime(1), author: makeAuthor('b1'), text: 'plain' },
      { id: 'a2', kind: 'text', createdAt: makeTime(2), author: makeAuthor('b1'), text: 'reply', replyToMessageId: 'm9', replyAuthor: 'bob' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.replyBlockId).toBe('m9')
    expect(agent.replyAuthor).toBe('bob')
  })

  it('splits text blocks from different authors into separate items', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'a1', kind: 'text', createdAt: makeTime(1), author: makeAuthor('b1'), text: 'a' },
      { id: 'a2', kind: 'text', createdAt: makeTime(2), author: makeAuthor('b2', 'ReviewerAgent'), text: 'b' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(2)
    expect((items[0] as AgentTranscriptBlock).id).toBe('b1-1')
    expect((items[1] as AgentTranscriptBlock).id).toBe('b2-2')
  })

  it('treats a system-role text block as an agent bubble', () => {
    const blocks: TranscriptBlock[] = [
      { id: 's1', kind: 'text', createdAt: makeTime(0), author: makeSystemAuthor('sys1'), text: 'system note' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.role).toBe('system')
    expect(agent.agent).toBe('System')
    expect(agent.bubbles).toEqual(['system note'])
  })

  it('falls back to role system and name Agent for an author-less text block', () => {
    const blocks = [
      { id: 't1', kind: 'text' as const, createdAt: makeTime(1), author: null as unknown as TranscriptBlock['author'], text: 'hello' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.agent).toBe('Agent')
    expect(agent.role).toBe('system')
    expect(agent.groupId).toBe('unknown')
    expect(agent.id).toBe('unknown-1')
    expect(agent.bubbles).toEqual(['hello'])
  })

  it('merges consecutive author-less text blocks into one item', () => {
    const blocks = [
      { id: 't1', kind: 'text' as const, createdAt: makeTime(1), author: null as unknown as TranscriptBlock['author'], text: 'a' },
      { id: 't2', kind: 'text' as const, createdAt: makeTime(2), author: null as unknown as TranscriptBlock['author'], text: 'b' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    expect((items[0] as AgentTranscriptBlock).bubbles).toEqual(['a', 'b'])
  })

  it('appends a text bubble to an existing structured group of the same author', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'x', isThinking: true },
      { id: 't1', kind: 'text', createdAt: makeTime(2), author: makeAuthor('b1'), text: 'hi' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(1)
    expect(agent.bubbles).toEqual(['hi'])
    expect(agent.parts!.map(p => p.type)).toEqual(['row', 'bubble'])
  })
})

describe('blocksToTranscriptItems — agent_timeline flattening', () => {
  it('maps every timeline status to the think status vocabulary', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [
          { label: 'A', status: 'completed' },
          { label: 'B', status: 'done' },
          { label: 'C', status: 'failed' },
          { label: 'D', status: 'todo' },
          { label: 'E', status: 'running' },
          { label: 'F', status: 'pending' },
        ],
      },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows!.map(r => r.status)).toEqual(['ok', 'ok', 'fail', 'waiting', 'running', 'running'])
  })

  it('builds think rows with id, label, collapsible flag and content', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [{ label: 'Compile', detail: 'Build succeeded', status: 'completed' }],
      },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows![0]).toMatchObject({
      id: 'tl1-Compile',
      type: 'think',
      label: '',
      status: 'ok',
      collapsible: true,
      content: 'Compile: Build succeeded',
    })
  })

  it('falls back to an empty detail suffix in the think content', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [{ label: 'Plan', status: 'todo' }],
      },
    ]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.content).toBe('Plan: ')
    expect(row.status).toBe('waiting')
  })

  it('falls back to running for an unknown timeline status', () => {
    const blocks = [
      {
        id: 'tl1', kind: 'agent_timeline' as const, createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [{ label: 'X', status: 'paused' as unknown as 'completed' }],
      },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('running')
  })

  it('produces no items for a timeline with an empty items array', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'), items: [] },
    ]
    expect(blocksToTranscriptItems(blocks)).toEqual([])
  })

  it('produces no items when the timeline items array is missing', () => {
    const blocks = [
      { id: 'tl1', kind: 'agent_timeline' as const, createdAt: makeTime(1), author: makeAuthor('b1') },
    ] as TranscriptBlock[]
    expect(blocksToTranscriptItems(blocks)).toEqual([])
  })

  it('appends timeline rows to an existing same-author group', () => {
    const blocks: TranscriptBlock[] = [
      { id: 't1', kind: 'text', createdAt: makeTime(1), author: makeAuthor('b1'), text: 'hi' },
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(2), author: makeAuthor('b1'),
        items: [{ label: 'X', status: 'completed' }],
      },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.bubbles).toEqual(['hi'])
    expect(agent.rows).toHaveLength(1)
    expect(agent.parts!.map(p => p.type)).toEqual(['bubble', 'row'])
  })

  it('creates a standalone timeline group using the plain author id', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [{ label: 'X', status: 'completed' }],
      },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.id).toBe('b1')
    expect(agent.role).toBe('agent')
    expect(agent.groupId).toBe('b1')
    expect(agent.evidenceRefs).toBeUndefined()
    expect(agent.time).toBeTruthy()
  })

  it('propagates evidenceRefs from the timeline block', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [{ label: 'X', status: 'completed' }],
        evidenceRefs: [{ id: 'er1', kind: 'run', label: 'Run', status: 'running' }],
      },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.evidenceRefs).toHaveLength(1)
    expect(agent.evidenceRefs![0]!.id).toBe('er1')
  })

  it('processes a human-authored timeline as an agent item with role human', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeUser('alice'),
        items: [{ label: 'S', status: 'completed' }],
      },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.role).toBe('human')
    expect(agent.agent).toBe(DEFAULT_USER_NAME)
    expect(agent.rows).toHaveLength(1)
  })
})

describe('blocksToTranscriptItems — run_step_group recursion', () => {
  it('maps children through mapBlock and wraps them in a sub row', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'rsg1', kind: 'run_step_group', createdAt: makeTime(1), author: makeAuthor('b1'),
        icon: '>', title: 'Commands', status: 'completed', open: true,
        children: [
          { id: 'tc1', kind: 'tool_call', author: makeUser('alice'), toolName: 'Read', status: 'running' } as TranscriptBlock,
        ],
      },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(1)
    const row = agent.rows![0]!
    expect(row.type).toBe('sub')
    expect(row.id).toBe('rsg1')
    expect(row.label).toBe('Commands')
    expect(row.status).toBe('ok')
    expect(row.collapsible).toBe(true)
    expect(row.open).toBe(true)
    expect(row.children).toHaveLength(1)
    expect(row.children![0]!.type).toBe('tool')
  })

  it('maps group statuses completed/failed/running/pending to ok/fail/running/running', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'g1', kind: 'run_step_group', author: makeAuthor('b1'), icon: '>', title: 'T1', status: 'completed', children: [] },
      { id: 'g2', kind: 'run_step_group', author: makeAuthor('b1'), icon: '>', title: 'T2', status: 'failed', children: [] },
      { id: 'g3', kind: 'run_step_group', author: makeAuthor('b1'), icon: '>', title: 'T3', status: 'running', children: [] },
      { id: 'g4', kind: 'run_step_group', author: makeAuthor('b1'), icon: '>', title: 'T4', status: 'pending', children: [] },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows!.map(r => r.status)).toEqual(['ok', 'fail', 'running', 'running'])
  })

  it('defaults open to false and preserves explicit open', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'g1', kind: 'run_step_group', author: makeAuthor('b1'), icon: '>', title: 'T1', status: 'completed', children: [] },
      { id: 'g2', kind: 'run_step_group', author: makeAuthor('b1'), icon: '>', title: 'T2', status: 'completed', open: true, children: [] },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows![0]!.open).toBe(false)
    expect(agent.rows![1]!.open).toBe(true)
  })

  it('maps group meta to row extra only when defined', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'g1', kind: 'run_step_group', author: makeAuthor('b1'), icon: '>', title: 'T1', status: 'completed', meta: 'startup', children: [] },
      { id: 'g2', kind: 'run_step_group', author: makeAuthor('b1'), icon: '>', title: 'T2', status: 'completed', children: [] },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows![0]!.extra).toBe('startup')
    expect(agent.rows![1]!.extra).toBeUndefined()
  })

  it('skips children that mapBlock drops', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'g1', kind: 'run_step_group', author: makeAuthor('b1'), icon: '>', title: 'T1', status: 'completed',
        children: [
          { id: 'r1', kind: 'result', author: makeAuthor('b1'), success: true } as TranscriptBlock,
        ],
      },
    ]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('sub')
    expect(row.children).toEqual([])
  })

  it('wraps an empty children array in a sub row with no children', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'g1', kind: 'run_step_group', author: makeAuthor('b1'), icon: '>', title: 'T1', status: 'completed', children: [] },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows![0]).toMatchObject({ type: 'sub', children: [] })
  })

  it('skips the whole group when children are missing', () => {
    const blocks = [
      { id: 'g1', kind: 'run_step_group' as const, createdAt: makeTime(1), author: makeAuthor('b1'), icon: '>', title: 'T1', status: 'completed' as const },
    ] as TranscriptBlock[]
    expect(blocksToTranscriptItems(blocks)).toEqual([])
  })

  it('propagates evidenceRefs onto a new group item', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'g1', kind: 'run_step_group', createdAt: makeTime(1), author: makeAuthor('b1'), icon: '>', title: 'T1', status: 'completed',
        children: [],
        evidenceRefs: [{ id: 'er1', kind: 'artifact', label: 'A', status: 'completed' }],
      },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.evidenceRefs).toHaveLength(1)
  })
})

describe('blocksToTranscriptItems — structured blocks and standalone routing', () => {
  it('maps a thinking block into an inline think row', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'x', isThinking: true },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(1)
    expect(agent.rows![0]!.type).toBe('think')
    expect(agent.standaloneRows).toEqual([])
  })

  it('routes all standalone card types to standaloneRows', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'rd1', kind: 'route_decision', author: makeAuthor('b1'), action: 'dispatch', summary: '→ builder' },
      { id: 'd1', kind: 'deploy', author: makeAuthor('b1'), runId: 'run-1', status: 'ready', url: 'https://preview.example.com' },
      { id: 'cu1', kind: 'context_usage', author: makeAuthor('b1'), inputTokens: 1000, outputTokens: 500, usagePercent: 40, modelLabel: 'gpt-4' },
      { id: 'ap1', kind: 'approval', author: makeAuthor('b1'), title: 'Allow', status: 'pending' },
      { id: 'rs1', kind: 'run_session', author: makeAuthor('b1'), title: 'Run #1', status: 'completed' },
      { id: 'at1', kind: 'attachment', author: makeAuthor('b1'), attachmentRef: { id: 'att-1', name: 'shot.png', size: 2048, mime_type: 'image/png' }, contentType: 'image' },
      { id: 'pv1', kind: 'preview', author: makeAuthor('b1'), previewId: 'prev-1', status: 'completed', url: 'https://example.com/a.html' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.rows).toEqual([])
    expect(agent.standaloneRows!.map(r => r.type)).toEqual([
      'route', 'deploy', 'ctx', 'approval', 'session', 'attachment', 'preview',
    ])
    expect(agent.parts).toHaveLength(7)
  })

  it('keeps inline card types in rows', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', author: makeAuthor('b1'), content: 'x', isThinking: true },
      { id: 'tc1', kind: 'tool_call', author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
      { id: 'fc1', kind: 'file_change', author: makeAuthor('b1'), path: 'a.ts', action: 'modified' },
      { id: 'sa1', kind: 'subagent', author: makeAuthor('b1'), title: 'T', worker: 'w', status: 'pending' },
      { id: 'f1', kind: 'failure', author: makeAuthor('b1'), title: 'E', reason: 'boom' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows!.map(r => r.type)).toEqual(['think', 'tool', 'file', 'sub', 'think'])
    expect(agent.standaloneRows).toEqual([])
  })

  it('drops result, finished and replay_gap blocks', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'r1', kind: 'result', createdAt: makeTime(1), author: makeAuthor('b1'), success: true },
      { id: 'f1', kind: 'finished', createdAt: makeTime(2), author: makeAuthor('b1'), title: 'done' },
      { id: 'rg1', kind: 'replay_gap', createdAt: makeTime(3), author: makeAuthor('b1'), replayedCount: 3 },
    ]
    expect(blocksToTranscriptItems(blocks)).toEqual([])
  })

  it('drops compact_boundary blocks', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'cb1', kind: 'compact_boundary', createdAt: makeTime(1), author: makeAuthor('b1') },
    ]
    expect(blocksToTranscriptItems(blocks)).toEqual([])
  })

  it('falls back to Agent/unknown for a structured block without an author', () => {
    const blocks = [
      { id: 'th1', kind: 'thinking' as const, createdAt: makeTime(1), author: null as unknown as TranscriptBlock['author'], content: 'x', isThinking: true },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.agent).toBe('Agent')
    expect(agent.role).toBe('system')
    expect(agent.groupId).toBe('unknown')
    expect(agent.id).toBe('unknown-1')
    expect(agent.rows![0]!.type).toBe('think')
  })

  it('propagates non-empty evidenceRefs onto a new agent item', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'x', isThinking: true,
        evidenceRefs: [{ id: 'er1', kind: 'tool', label: 'Logs', status: 'completed' }],
      },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.evidenceRefs).toHaveLength(1)
    expect(agent.evidenceRefs![0]!.id).toBe('er1')
  })

  it('omits evidenceRefs when the block list is empty', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'x', isThinking: true, evidenceRefs: [] },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.evidenceRefs).toBeUndefined()
  })

  it('merges mixed same-author kinds into one item preserving part order', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'think', isThinking: true },
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'running', target: 'a.ts' },
      { id: 't1', kind: 'text', createdAt: makeTime(3), author: makeAuthor('b1'), text: 'hello' },
      { id: 'rd1', kind: 'route_decision', createdAt: makeTime(4), author: makeAuthor('b1'), action: 'dispatch', summary: '→ builder' },
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(5), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'done' },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(2)
    expect(agent.rows![0]!.type).toBe('think')
    expect(agent.rows![1]).toMatchObject({ id: 'tc1', type: 'tool', status: 'ok', content: 'done', isResult: true })
    expect(agent.bubbles).toEqual(['hello'])
    expect(agent.standaloneRows).toHaveLength(1)
    expect(agent.standaloneRows![0]!.type).toBe('route')
    expect(agent.parts!.map(p => p.type)).toEqual(['row', 'row', 'bubble', 'row'])
  })

  it('derives the structured agent id from the absolute block position', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', createdAt: makeTime(0), author: makeUser('alice'), text: 'q' },
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'x', isThinking: true },
    ]
    const items = blocksToTranscriptItems(blocks)
    expect((items[1] as AgentTranscriptBlock).id).toBe('b1-2')
  })
})

describe('blocksToTranscriptItems — tool call/result merging', () => {
  it('merges a tool_result into its tool_call by toolName', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: '42 lines' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(1)
    expect(agent.rows![0]).toMatchObject({
      id: 'tc1', type: 'tool', status: 'ok', content: '42 lines', isResult: true,
    })
  })

  it('replaces the toolCallId with the result row via spread semantics', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-1', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'out' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(1)
    expect(agent.rows![0]).toMatchObject({ id: 'tc1', content: 'out', isResult: true })
    expect(agent.rows![0]!.toolCallId).toBeUndefined()
  })

  it('pairs multiple same-name calls with results in FIFO order', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'c1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'running', target: 'file1' },
      { id: 'c2', kind: 'tool_call', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'running', target: 'file2' },
      { id: 'r1', kind: 'tool_result', createdAt: makeTime(3), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'content1' },
      { id: 'r2', kind: 'tool_result', createdAt: makeTime(4), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'content2' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(2)
    expect(agent.rows![0]).toMatchObject({ id: 'c1', content: 'content1', isResult: true })
    expect(agent.rows![1]).toMatchObject({ id: 'c2', content: 'content2', isResult: true })
  })

  it('matches results by callId even when they arrive out of order', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'call-a', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-a', status: 'running' },
      { id: 'call-b', kind: 'tool_call', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-b', status: 'running' },
      { id: 'res-b', kind: 'tool_result', createdAt: makeTime(3), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-b', status: 'completed', summary: 'b result' },
      { id: 'res-a', kind: 'tool_result', createdAt: makeTime(4), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-a', status: 'completed', summary: 'a result' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(2)
    expect(agent.rows![0]).toMatchObject({ id: 'call-a', content: 'a result', toolCallId: 'toolu-a' })
    expect(agent.rows![1]).toMatchObject({ id: 'call-b', content: 'b result', toolCallId: 'toolu-b' })
  })

  it('does not merge same-name blocks with different callIds', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'call-a', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-a', status: 'running' },
      { id: 'res-b', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-b', status: 'completed', summary: 'x' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(2)
    expect(agent.rows![0]!.isResult).toBeUndefined()
    expect(agent.rows![1]!.isResult).toBe(true)
  })

  it('lets a matching callId win over a mismatched toolName', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'call-w', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-c', status: 'running' },
      { id: 'res-w', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Write', callId: 'toolu-c', status: 'completed', summary: 'written' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(1)
    expect(agent.rows![0]).toMatchObject({
      id: 'call-w', label: 'Write', toolName: 'write', toolCallId: 'toolu-c', status: 'ok', isResult: true,
    })
  })

  it('pushes an unmatched tool_result as its own row', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'call-x', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
      { id: 'res-y', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Write', status: 'completed', summary: 'out' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(2)
    expect(agent.rows![1]).toMatchObject({ id: 'res-y', isResult: true, content: 'out' })
  })

  it('pushes a duplicate result for an already-merged call as a separate row', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'call-d', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-1', status: 'running' },
      { id: 'res-1', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-1', status: 'completed', summary: 'first' },
      { id: 'res-2', kind: 'tool_result', createdAt: makeTime(3), author: makeAuthor('b1'), toolName: 'Read', callId: 'toolu-1', status: 'completed', summary: 'second' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(2)
    expect(agent.rows![0]).toMatchObject({ id: 'call-d', content: 'first', isResult: true })
    expect(agent.rows![1]).toMatchObject({ id: 'res-2', content: 'second', isResult: true })
  })

  it('updates the parts stream in place when a tool result replaces its call', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: '42 lines' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.parts).toHaveLength(1)
    expect(agent.parts![0]).toMatchObject({ type: 'row', row: { id: 'tc1', content: '42 lines', isResult: true } })
  })

  it('reflects a failed tool_result status in the merged row', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Bash', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Bash', status: 'failed', summary: 'exit 1' },
    ]
    const agent = blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(1)
    expect(agent.rows![0]).toMatchObject({ id: 'tc1', status: 'fail', isResult: true, content: 'exit 1' })
  })
})

describe('resolveUnreadAnchorItemIndex', () => {
  const userText = (id: string, authorId = 'alice', offset = 0): TranscriptBlock => ({
    id, kind: 'text', createdAt: makeTime(offset), author: makeUser(authorId), text: 'msg ' + id,
  })
  const agentText = (id: string, authorId = 'b1', offset = 0): TranscriptBlock => ({
    id, kind: 'text', createdAt: makeTime(offset), author: makeAuthor(authorId), text: 'reply ' + id,
  })

  it('returns -1 without a descriptor', () => {
    const blocks = [userText('m1')] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(resolveUnreadAnchorItemIndex(blocks, items, undefined)).toBe(-1)
  })

  it('returns -1 when the count is zero', () => {
    const blocks = [userText('m1')] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'm1', count: 0 })).toBe(-1)
  })

  it('returns -1 when the count is negative', () => {
    const blocks = [userText('m1')] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'm1', count: -3 })).toBe(-1)
  })

  it('returns -1 when the items array is empty', () => {
    const blocks = [userText('m1')] as TranscriptBlock[]
    expect(resolveUnreadAnchorItemIndex(blocks, [], { anchorBlockId: 'm1', count: 1 })).toBe(-1)
  })

  it('falls back to the unread tail when no anchorBlockId is given', () => {
    const blocks = [
      userText('m1', 'alice', 0),
      userText('m2', 'alice', 1),
      userText('m3', 'alice', 2),
      userText('m4', 'alice', 3),
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { count: 2 })).toBe(2)
  })

  it('falls back to the tail and clamps at zero when the anchor block is missing', () => {
    const blocks = [
      userText('m1', 'alice', 0),
      userText('m2', 'alice', 1),
      userText('m3', 'alice', 2),
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'ghost', count: 2 })).toBe(1)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'ghost', count: 99 })).toBe(0)
  })

  it('returns index 0 when the anchor is the first block', () => {
    const blocks = [
      userText('m1', 'alice', 0),
      userText('m2', 'alice', 1),
      userText('m3', 'alice', 2),
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'm1', count: 3 })).toBe(0)
  })

  it('treats a merged agent group as a single containing item', () => {
    const blocks = [
      userText('u1', 'alice', 0),
      agentText('a1', 'b1', 1),
      agentText('a2', 'b1', 2),
      agentText('a3', 'b1', 3),
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(2)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'a2', count: 2 })).toBe(1)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'a1', count: 3 })).toBe(1)
  })

  it('locates a user item after an interleaved agent group', () => {
    const blocks = [
      userText('u1', 'alice', 0),
      agentText('a1', 'b1', 1),
      userText('u2', 'alice', 2),
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(3)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'u2', count: 1 })).toBe(2)
  })

  it('counts human attachment blocks as item starts (#1957)', () => {
    const blocks: TranscriptBlock[] = [
      userText('u1', 'alice', 0),
      {
        id: 'att1', kind: 'attachment', createdAt: makeTime(1), author: makeUser('alice'),
        attachmentRef: { id: 'att-1', name: 'f.txt', size: 10, mime_type: 'text/plain' }, contentType: 'file',
      },
      agentText('a1', 'b1', 2),
    ]
    const items = blocksToTranscriptItems(blocks)
    // u1 user item + att1 user item + a1 agent item.
    expect(items).toHaveLength(3)
    // The attachment block starts its own user item, so an anchor on it
    // resolves to item 1 and an anchor on the following agent text to item 2.
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'att1', count: 1 })).toBe(1)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'a1', count: 1 })).toBe(2)
  })

  it('still ignores human non-text non-attachment blocks when counting item starts', () => {
    const blocks: TranscriptBlock[] = [
      userText('u1', 'alice', 0),
      {
        id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeUser('alice'),
        content: 'x', isThinking: true,
      },
      agentText('a1', 'b1', 2),
    ]
    const items = blocksToTranscriptItems(blocks)
    // Human-authored thinking blocks are dropped by the adapter.
    expect(items).toHaveLength(2)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'a1', count: 1 })).toBe(1)
  })

  it('groups author-less blocks under the unknown author id', () => {
    const blocks = [
      { id: 't1', kind: 'text' as const, createdAt: makeTime(0), author: null as unknown as TranscriptBlock['author'], text: 'a' },
      userText('u1', 'alice', 1),
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(2)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'u1', count: 1 })).toBe(1)
  })

  it('counts agent blocks that the adapter later drops, so the index can reach items.length', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'r1', kind: 'result', createdAt: makeTime(0), author: makeAuthor('b1'), success: true },
      userText('u1', 'alice', 1),
    ]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'u1', count: 1 })).toBe(1)
  })
})

describe('resolveCompactDividerIndices', () => {
  const boundary = (id: string, trigger?: string, preTokens?: number): TranscriptBlock =>
    ({ id, kind: 'compact_boundary', createdAt: makeTime(1), author: makeAuthor('b1'), trigger, preTokens })
  const userText = (id: string, authorId = 'alice', offset = 0): TranscriptBlock => ({
    id, kind: 'text', createdAt: makeTime(offset), author: makeUser(authorId), text: 'msg ' + id,
  })
  const agentText = (id: string, authorId = 'b1', offset = 0): TranscriptBlock => ({
    id, kind: 'text', createdAt: makeTime(offset), author: makeAuthor(authorId), text: 'reply ' + id,
  })

  it('returns an empty array for empty blocks', () => {
    expect(resolveCompactDividerIndices([])).toEqual([])
  })

  it('returns an empty array when there are no boundaries', () => {
    const blocks = [userText('u1'), agentText('a1', 'b1', 1)] as TranscriptBlock[]
    expect(resolveCompactDividerIndices(blocks)).toEqual([])
  })

  it('places a lone boundary at index 0', () => {
    expect(resolveCompactDividerIndices([boundary('cb1')])).toEqual([{ index: 0 }])
  })

  it('propagates trigger and preTokens metadata', () => {
    const blocks = [boundary('cb1', 'auto', 1234)] as TranscriptBlock[]
    expect(resolveCompactDividerIndices(blocks)).toEqual([{ index: 0, trigger: 'auto', preTokens: 1234 }])
  })

  it('keeps a zero preTokens and omits an empty trigger', () => {
    const blocks = [boundary('cb1', '', 0)] as TranscriptBlock[]
    expect(resolveCompactDividerIndices(blocks)).toEqual([{ index: 0, preTokens: 0 }])
  })

  it('counts each user text block as one item', () => {
    const blocks = [
      userText('u1', 'alice', 0),
      userText('u2', 'alice', 1),
      boundary('cb1'),
    ] as TranscriptBlock[]
    expect(resolveCompactDividerIndices(blocks)).toEqual([{ index: 2 }])
  })

  it('counts a merged agent group as one item', () => {
    const blocks = [
      agentText('a1', 'b1', 0),
      agentText('a2', 'b1', 1),
      boundary('cb1'),
    ] as TranscriptBlock[]
    expect(resolveCompactDividerIndices(blocks)).toEqual([{ index: 1 }])
  })

  it('does not split a same-author group across a boundary', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(0), author: makeAuthor('b1'), content: 'x', isThinking: true },
      boundary('cb1'),
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
    ]
    expect(resolveCompactDividerIndices(blocks)).toEqual([{ index: 1 }])
  })

  it('increments the item index when the author changes', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(0), author: makeAuthor('b1'), content: 'x', isThinking: true },
      { id: 'th2', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b2'), content: 'y', isThinking: true },
      boundary('cb1'),
    ]
    expect(resolveCompactDividerIndices(blocks)).toEqual([{ index: 2 }])
  })

  it('counts human attachment blocks as items (#1957)', () => {
    const blocks: TranscriptBlock[] = [
      userText('u1', 'alice', 0),
      {
        id: 'att1', kind: 'attachment', createdAt: makeTime(1), author: makeUser('alice'),
        attachmentRef: { id: 'att-1', name: 'f.txt', size: 10, mime_type: 'text/plain' }, contentType: 'file',
      },
      boundary('cb1'),
    ]
    // u1 and att1 each start a user item, so the divider lands before item 2.
    expect(resolveCompactDividerIndices(blocks)).toEqual([{ index: 2 }])
  })

  it('does not count human non-text non-attachment blocks as items', () => {
    const blocks: TranscriptBlock[] = [
      userText('u1', 'alice', 0),
      {
        id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeUser('alice'),
        content: 'x', isThinking: true,
      },
      boundary('cb1'),
    ]
    expect(resolveCompactDividerIndices(blocks)).toEqual([{ index: 1 }])
  })

  it('keeps consecutive boundaries at the same index', () => {
    const blocks = [boundary('cb1'), boundary('cb2', 'manual')] as TranscriptBlock[]
    expect(resolveCompactDividerIndices(blocks)).toEqual([
      { index: 0 },
      { index: 0, trigger: 'manual' },
    ])
  })

  it('returns descriptors sorted by ascending index across the transcript', () => {
    const blocks: TranscriptBlock[] = [
      userText('u1', 'alice', 0),
      boundary('cb1', 'auto'),
      agentText('a1', 'b1', 1),
      agentText('a2', 'b1', 2),
      boundary('cb2', 'manual', 999),
    ]
    expect(resolveCompactDividerIndices(blocks)).toEqual([
      { index: 1, trigger: 'auto' },
      { index: 2, trigger: 'manual', preTokens: 999 },
    ])
  })

  it('counts system-role blocks as agent-like items', () => {
    const blocks: TranscriptBlock[] = [
      { id: 's1', kind: 'text', createdAt: makeTime(0), author: makeSystemAuthor('sys1'), text: 'note' },
      boundary('cb1'),
    ]
    expect(resolveCompactDividerIndices(blocks)).toEqual([{ index: 1 }])
  })

  it('does not count a human-authored timeline, diverging from the adapter grouping', () => {
    // The adapter itself creates an agent item for this block; the compact
    // divider simulation only counts human *text or attachment* and
    // agent/system blocks.
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(0), author: makeUser('alice'),
        items: [{ label: 'S', status: 'completed' }],
      },
      boundary('cb1'),
    ]
    expect(resolveCompactDividerIndices(blocks)).toEqual([{ index: 0 }])
  })
})
