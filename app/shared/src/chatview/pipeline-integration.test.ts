/* ═══════════════════════════════════════════════════════════════════════
   PIPELINE INTEGRATION TESTS
   Full end-to-end exercise of the ChatView pipeline:

   Pipeline 1: Edge event => normalizeEdgeEventsToTranscript() => TranscriptBlock[]
               => blocksToTranscriptItems() => TranscriptItem[] => DOM assertions

   Pipeline 2: Hub message => normalizeHubMessagesToTranscript() => TranscriptBlock[]
               => blocksToTranscriptItems() => TranscriptItem[] => DOM assertions

   Pipeline 3: Streaming -- incremental block append => verify key stability
               and React reconciliation safety across snapshots

   Pipeline 4: Error handling -- malformed blocks => graceful degradation
               (no crash, valid output, structural invariants hold)

   These tests verify that the full data flow from raw events/messages
   through normalization, adaptation, and into renderable items works
   correctly end-to-end. They complement the existing unit tests for
   each individual stage by testing cross-stage contracts.
   ══════════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest'
import type { EventEnvelope } from '../events'
import { normalizeEdgeEventsToTranscript } from '../transcript/normalizeEdgeEvents'
import { normalizeHubMessagesToTranscript } from '../transcript/normalizeHubMessages'
import type { HubMessageTranscriptInput } from '../transcript/normalizeHubMessages'
import { blocksToTranscriptItems } from './adapter'
import { simulateStreaming, verifyStreamingKeyStability } from './streaming.test'
import type { TranscriptAgentItem, TranscriptItem, TranscriptUserItem } from './transcript-item'

function isTranscriptAgentItem(item: TranscriptItem): item is TranscriptAgentItem {
  return !('type' in item && item.type === 'user')
}
import type { TranscriptBlock, TextTranscriptBlock } from '../transcript/types'

/* ═══════════════════════════════════════════════════════════════════════
   HELPER -- build minimal EventEnvelope / HubMessageTranscriptInput
   ══════════════════════════════════════════════════════════════════════ */

const NOW = '2026-06-17T14:30:00.000Z'
let _seq = 0
function nextSeq() { return ++_seq }

function edgeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    version: '1.0',
    id: `evt-${nextSeq()}`,
    seq: nextSeq(),
    type: 'message.created',
    scope: { projectId: 'proj-1', conversationId: 'conv-1' },
    traceId: `trace-${nextSeq()}`,
    sentAt: NOW,
    payload: {},
    ...overrides,
  } as EventEnvelope
}

function hubMsg(overrides: Partial<HubMessageTranscriptInput> = {}): HubMessageTranscriptInput {
  return {
    id: `msg-${nextSeq()}`,
    session_id: 'session-1',
    seq_id: nextSeq(),
    sender_type: 'user',
    sender_id: 'user-1',
    content: { text: 'hello' },
    created_at: NOW,
    ...overrides,
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   PIPELINE 1 -- Edge Event => TextBlock => Adapter => TranscriptItem
   ══════════════════════════════════════════════════════════════════════ */

describe('Pipeline 1: Edge event -> normalize -> adapter -> TranscriptItem', () => {

  /* -- 1a. Single text_delta => agent text block => agent bubble -- */

  it('1a: run.agent.text_delta => agent text block => single TranscriptAgentItem with bubble', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-1', content: 'Hello from the agent' },
      }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('text')
    expect((blocks[0]! as TextTranscriptBlock).text).toBe('Hello from the agent')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.agent).toBe('Agent')
    expect(agent.role).toBe('agent')
    expect(agent.bubbles).toEqual(['Hello from the agent'])
    expect(agent.rows).toHaveLength(0)
  })

  /* -- 1b. Multiple text_delta => merged text block => single bubble -- */

  it('1b: consecutive run.agent.text_delta events merge into one block => one bubble', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-1', content: 'Part one.' },
      }),
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-1', content: 'Part two.' },
      }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    // Merged: last.text + block.text = 'Part one.' + 'Part two.' (no separator)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('text')
    expect((blocks[0]! as TextTranscriptBlock).text).toBe('Part one.Part two.')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.bubbles).toEqual(['Part one.Part two.'])
    expect(agent.rows).toHaveLength(0)
  })

  /* -- 1c. thinking + tool_call + tool_result full cycle -- */

  it('1c: thinking => tool_call => tool_result => merged tool card + thinking card', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.agent.thinking',
        payload: { runId: 'run-1', content: 'Let me read the file...' },
      }),
      edgeEvent({
        type: 'run.agent.tool_call',
        payload: { runId: 'run-1', toolName: 'Read', callId: 'call-1', status: 'running' },
      }),
      edgeEvent({
        type: 'run.agent.tool_result',
        payload: { runId: 'run-1', toolName: 'Read', callId: 'call-1', status: 'running', content: '42 lines found' },
      }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks).toHaveLength(3)
    expect(blocks[0]!.kind).toBe('thinking')
    expect(blocks[1]!.kind).toBe('tool_call')
    expect(blocks[2]!.kind).toBe('tool_result')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem

    // thinking card + merged tool card (call+result)
    expect(agent.rows).toHaveLength(2)

    const thinkRow = agent.rows[0]!
    expect(thinkRow.type).toBe('think')
    expect(thinkRow.content).toBe('Let me read the file...')

    const toolRow = agent.rows[1]!
    expect(toolRow.type).toBe('tool')
    expect(toolRow.toolName).toBe('read')
    expect(toolRow.isResult).toBe(true)
    expect(toolRow.status).toBe('ok')
    expect(toolRow.content).toBe('42 lines found')
  })

  /* -- 1d. run.output events => Edge-author text blocks, merge when same author+run -- */

  it('1d: run.output events produce Edge-author text blocks grouped by author+run', () => {
    const events: EventEnvelope[] = [
      {
        version: '1.0', id: 'evt-out-1', seq: 1,
        type: 'run.output' as const,
        scope: { runId: 'run-out-1' },
        sentAt: NOW,
        payload: { runId: 'run-out-1', stream: 'stdout' as const, offset: 0, text: 'stdout line 1\n' },
      },
      {
        version: '1.0', id: 'evt-out-2', seq: 2,
        type: 'run.output' as const,
        scope: { runId: 'run-out-1' },
        sentAt: '2026-06-17T14:30:01.000Z',
        payload: { runId: 'run-out-1', stream: 'stdout' as const, offset: 15, text: 'stdout line 2\n' },
      },
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    // Both share EDGE_AUTHOR (id='edge') and same run (run-out-1) => merged
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('text')
    expect(blocks[0]!.author.role).toBe('system')
    expect(blocks[0]!.author.name).toBe('Edge')

    const items = blocksToTranscriptItems(blocks)
    // Edge author role = 'system', so it becomes an agent-item bubble
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.bubbles).toHaveLength(1)
  })

  /* -- 1e. Full run lifecycle -- run.started through run.finished -- */

  it('1e: lifecycle events stay out of chat while agent text remains visible', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.started',
        payload: { runId: 'run-1', startedAt: NOW },
      }),
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-1', content: 'Task completed successfully.' },
      }),
      edgeEvent({
        type: 'run.finished',
        payload: { runId: 'run-1', finishedAt: '2026-06-17T14:35:00.000Z', durationMs: 300000 },
      }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    // run.started is lifecycle-only and belongs to run state/activity stores.
    // run.agent.text_delta remains conversational content.
    // run.finished is terminal metadata and is skipped by adapter's mapBlock.
    expect(blocks).toHaveLength(2)

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)

    const bubbles = items
      .filter((i): i is TranscriptAgentItem => 'bubbles' in i)
      .flatMap((a) => a.bubbles)
    expect(bubbles).toContain('Task completed successfully.')
  })

  /* -- 1f. run.failed => failure block => adapter fail card -- */

  it('1f: run.failed => failure block => adapter maps to fail-status think RowItem', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.failed',
        payload: { runId: 'run-err', reason: 'Out of memory', finishedAt: NOW },
      }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('failure')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.rows).toHaveLength(1)
    const row = agent.rows[0]!
    expect(row.type).toBe('think')
    expect(row.status).toBe('fail')
    expect(row.content).toBe('Out of memory')
  })

  /* -- 1g. run.agent.file_change => file RowItem with patch => diffLines -- */

  it('1g: run.agent.file_change with diff => file RowItem with diffLines', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.agent.file_change',
        payload: {
          runId: 'run-1',
          path: 'src/app.ts',
          kind: 'modified',
          diff: '+ added line\n- removed line\n unchanged',
        },
      }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('file_change')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.rows).toHaveLength(1)
    const row = agent.rows[0]!
    expect(row.type).toBe('file')
    expect(row.fileOp).toBe('mod')
    expect(row.extra).toBe('src/app.ts')
    expect(row.diffLines).toBeDefined()
    expect(row.diffLines!.length).toBeGreaterThanOrEqual(2)
  })

  /* -- 1h. Empty events array => empty TranscriptBlock[] => empty TranscriptItem[] -- */

  it('1h: empty events => empty blocks => empty items (no crash)', () => {
    expect(normalizeEdgeEventsToTranscript([])).toEqual([])
    expect(normalizeEdgeEventsToTranscript(undefined)).toEqual([])
    expect(blocksToTranscriptItems([])).toEqual([])
  })

  /* -- 1i. Thinking auto-transition: thinking=>non-thinking marks prior as completed -- */

  it('1i: thinking followed by non-thinking auto-completes earlier thinking blocks', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.agent.thinking',
        payload: { runId: 'run-1', content: 'Analyzing...', status: 'running' },
      }),
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-1', content: 'Done thinking.' },
      }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    // Post-processing: auto-transition thinking.isThinking = false when next block is non-thinking
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.kind).toBe('thinking')
    // After auto-transition, isThinking should be false
    const thinkingBlock = blocks[0]! as Extract<TranscriptBlock, { kind: 'thinking' }>
    expect(thinkingBlock.isThinking).toBe(false)

    const items = blocksToTranscriptItems(blocks)
    // Thinking block (Agent author) + text_delta (Agent author) -- group together
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    // First row is thinking card with ok status (isThinking=false)
    const thinkRow = agent.rows[0]!
    expect(thinkRow.type).toBe('think')
    expect(thinkRow.status).toBe('ok')
    // Second bubble has the text
    expect(agent.bubbles).toEqual(['Done thinking.'])
  })

  /* -- 1j. text_delta from different runs do NOT merge (different evidenceRunId) -- */

  it('1j: text_delta from different runs produce separate blocks (different evidenceRunId)', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-1', content: 'Output from run 1.' },
      }),
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-2', content: 'Output from run 2.' },
      }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    // Same AGENT_AUTHOR but different evidenceRunId (run-1 vs run-2) => NOT merged
    expect(blocks).toHaveLength(2)
    expect((blocks[0]! as TextTranscriptBlock).text).toBe('Output from run 1.')
    expect((blocks[1]! as TextTranscriptBlock).text).toBe('Output from run 2.')

    const items = blocksToTranscriptItems(blocks)
    // Both share AGENT_AUTHOR: blocksToTranscriptItems merges consecutive blocks
    // with same author.id (both 'agent') into one TranscriptAgentItem
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.bubbles).toEqual(['Output from run 1.', 'Output from run 2.'])
  })

  /* -- 1k. Cross-author text blocks: agent + edge => separate groups in adapter -- */

  it('1k: agent text + edge output => separate groups in adapter (different authors)', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-1', content: 'Agent says hello' },
      }),
      // Edge output from a different run
      {
        version: '1.0', id: 'evt-edge', seq: 99,
        type: 'run.output' as const,
        scope: { runId: 'run-out' },
        sentAt: '2026-06-17T14:30:05.000Z',
        payload: { runId: 'run-out', stream: 'stdout' as const, offset: 0, text: 'stdout output' },
      },
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    // AGENT_AUTHOR (id='agent') vs EDGE_AUTHOR (id='edge') => separate blocks
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.author.id).toBe('agent')
    expect(blocks[1]!.author.id).toBe('edge')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(2)
    expect((items[0] as TranscriptAgentItem).bubbles).toContain('Agent says hello')
    expect((items[1] as TranscriptAgentItem).bubbles).toContain('stdout output')
  })
})

/* ═══════════════════════════════════════════════════════════════════════
   PIPELINE 2 -- Hub Message => Normalize => TranscriptBlock => Adapter
   ══════════════════════════════════════════════════════════════════════ */

describe('Pipeline 2: Hub message -> normalize -> adapter -> TranscriptItem', () => {

  /* -- 2a. Simple user text => TranscriptUserItem -- */

  it('2a: user text message => TextTranscriptBlock => TranscriptUserItem', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        content: { text: 'Hello from Hub user' },
        sender_type: 'user',
        sender_id: 'user-alice',
        sender: { nickname: 'Alice' },
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('text')
    expect((blocks[0]! as TextTranscriptBlock).text).toBe('Hello from Hub user')
    expect(blocks[0]!.author.role).toBe('human')
    expect(blocks[0]!.author.name).toBe('Alice')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const userItem = items[0] as TranscriptUserItem
    expect(userItem.type).toBe('user')
    expect(userItem.text).toBe('Hello from Hub user')
    expect(userItem.name).toBe('Alice')
  })

  /* -- 2b. Agent text message => TranscriptAgentItem with bubble -- */

  it('2b: agent text message => TextTranscriptBlock => TranscriptAgentItem with bubble', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        content: { text: 'Agent response from Hub' },
        sender_type: 'agent',
        sender_id: 'agent-42',
        sender: { nickname: 'Hub Builder' },
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('text')
    expect(blocks[0]!.author.role).toBe('agent')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.agent).toBe('Hub Builder')
    expect(agent.bubbles).toEqual(['Agent response from Hub'])
    expect(agent.rows).toHaveLength(0)
  })

  /* -- 2c. System message => TranscriptAgentItem (role system treated as bubble) -- */

  it('2c: system sender => TranscriptAgentItem with bubble', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        content: { text: 'System notification' },
        sender_type: 'system',
        sender_id: 'sys-1',
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.author.role).toBe('system')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.role).toBe('system')
    expect(agent.bubbles).toEqual(['System notification'])
  })

  /* -- 2d. Recalled message => "..." text -- */

  it('2d: recalled message => text block with recall placeholder', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        recalled: true,
        sender_type: 'user',
        content: 'This was recalled',
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('text')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    expect((items[0] as TranscriptUserItem).text).toBeDefined()
  })

  /* -- 2e. Image attachment with agent sender_role => standalone attachment RowItem -- */

  it('2e: image message from agent with attachment => attachment block => standalone RowItem', () => {
    // Agent-authored attachment blocks reach the structured-rows path and
    // become standalone cards; human-authored attachment blocks are covered
    // by 2e2 (#1957) and ride a user item instead.
    const msgs: HubMessageTranscriptInput[] = [
      {
        id: 'img-agent-msg',
        session_id: 'session-1',
        seq_id: 10,
        sender_type: 'agent',
        sender_id: 'agent-42',
        sender: { nickname: 'AgentBot' },
        content_type: 'image',
        created_at: NOW,
        attachments: [{
          id: 'att-1',
          hash: 'abc123',
          size: 51200,
          mime_type: 'image/png',
          original_name: 'screenshot.png',
        }],
      },
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('attachment')
    expect(blocks[0]!.author.role).toBe('agent')

    const items = blocksToTranscriptItems(blocks)
    // Attachment block author role='agent' => reaches structured-rows path
    // attachment is a standalone card type
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.standaloneRows.length).toBeGreaterThanOrEqual(1)
    const row = agent.standaloneRows[0]!
    expect(row.type).toBe('attachment')
    expect(row.fileName).toBe('screenshot.png')
    expect(row.fileSize).toBe('50 KB')
  })

  /* -- 2e2. Image attachment with user sender_type => user item attachment row (#1957) -- */

  it('2e2: image message from user => attachment block => user item attachment row (#1957)', () => {
    // Closing the send-image -> see-image loop: the sender's own upload is
    // normalized into a human-authored attachment block and the adapter
    // keeps it on a user item (image marker + ref preserved for the port).
    const msgs: HubMessageTranscriptInput[] = [
      {
        id: 'img-user-msg',
        session_id: 'session-1',
        seq_id: 11,
        sender_type: 'user',
        sender_id: 'user-alice',
        sender: { nickname: 'Alice' },
        content_type: 'image',
        created_at: NOW,
        attachments: [{
          id: 'att-2',
          hash: 'def456',
          size: 2048,
          mime_type: 'image/png',
          original_name: 'photo.png',
        }],
      },
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('attachment')
    expect(blocks[0]!.author.role).toBe('human')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const userItem = items[0] as TranscriptUserItem
    expect(userItem.type).toBe('user')
    expect(userItem.name).toBe('Alice')
    expect(userItem.text).toBe('')
    expect(userItem.attachments).toHaveLength(1)
    const row = userItem.attachments![0]!
    expect(row.type).toBe('attachment')
    expect(row.attachmentKind).toBe('image')
    expect(row.fileName).toBe('photo.png')
    expect(row.fileSize).toBe('2 KB')
  })

  /* -- 2f. Agent DM display metadata => displayTitle + badgeLabel -- */

  it('2f: Agent DM message => displayTitle on the block', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        id: 'dm-msg-1',
        sender_type: 'user',
        sender_id: 'user-1',
        sender: { nickname: 'User' },
        content: {
          text: 'Please review this PR',
          im_kind: 'agent_dm',
          to_agent: { id: 'agent-reviewer', label: 'ReviewerAgent' },
        },
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    const textBlock = blocks[0]! as TextTranscriptBlock
    expect(textBlock.kind).toBe('text')
    // When sender is human, displayTitle is set if isAgentDM is true
    expect(textBlock.displayTitle).toBe('Agent DM')
    // displayDetail contains IM kind info
    expect(textBlock.displayDetail).toContain('IM agent_dm')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const userItem = items[0] as TranscriptUserItem
    expect(userItem.displayTitle).toBe('Agent DM')
  })

  /* -- 2g. Agent-to-agent message => displayTitle 'Agent -> Agent' -- */

  it('2g: Agent-to-agent => displayTitle "Agent -> Agent"', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        sender_type: 'agent',
        sender_id: 'agent-builder',
        sender: { nickname: 'Builder' },
        content: {
          text: 'Task delegated to you',
          im_kind: 'agent_dm',
          from_agent: { id: 'agent-builder', label: 'Builder' },
          to_agent: { id: 'agent-reviewer', label: 'Reviewer' },
        },
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    const textBlock = blocks[0]! as TextTranscriptBlock
    expect(textBlock.displayTitle).toBe('Agent -> Agent')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
  })

  /* -- 2h. Agent task with status badge => badgeLabel + badgeVariant -- */

  it('2h: Agent task message => badgeLabel with status and badgeVariant', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        sender_type: 'agent',
        sender_id: 'agent-1',
        content: {
          text: 'Running the build...',
          agent_task: {
            id: 'task-build',
            status: 'running' as const,
          },
        },
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    const textBlock = blocks[0]! as TextTranscriptBlock
    expect(textBlock.badgeLabel).toBe('@Agent running')
    expect(textBlock.badgeVariant).toBe('thinking')
  })

  /* -- 2i. Route decision metadata => routeDecision block => standalone route RowItem -- */

  it('2i: route_decision content => route_decision block => standalone route RowItem', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        sender_type: 'agent',
        sender_id: 'agent-orch',
        content: {
          text: 'Routing to specialist',
          route_decision: {
            action: 'delegate',
            summary: 'Delegating code review to specialist',
            target_agent: 'code-reviewer-agent',
          },
        },
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('route_decision')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.standaloneRows).toHaveLength(1)
    const row = agent.standaloneRows[0]!
    expect(row.type).toBe('route')
    expect(row.label).toBe('delegate')
  })

  /* -- 2j. Empty messages => empty blocks => empty items -- */

  it('2j: empty messages => empty TranscriptBlock[] => empty TranscriptItem[]', () => {
    expect(normalizeHubMessagesToTranscript([])).toEqual([])
    expect(normalizeHubMessagesToTranscript(undefined)).toEqual([])
  })

  /* -- 2k. Whitespace-only content => filtered out -- */

  it('2k: whitespace-only content => block skipped (no empty items)', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        content: '   ',
        sender_type: 'user',
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(0)
  })

  /* -- 2l. JSON string content parsed => text extracted -- */

  it('2l: JSON string content => parsed => text extracted and rendered', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        sender_type: 'user',
        content: '{"text":"Parsed from JSON string"}',
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    expect((blocks[0]! as TextTranscriptBlock).text).toBe('Parsed from JSON string')
  })

  /* -- 2m. Group @Agent message => displayTitle + badgeLabel -- */

  it('2m: Group @Agent with mentions => displayTitle "Group @Agent"', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        sender_type: 'user',
        sender: { nickname: 'User' },
        content: {
          text: '@Builder @Reviewer check this',
          mentions: [
            { id: 'agent-builder', label: 'Builder' },
            { id: 'agent-reviewer', label: 'Reviewer' },
          ],
        },
      }),
    ]

    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    const textBlock = blocks[0]! as TextTranscriptBlock
    expect(textBlock.displayTitle).toBe('Group @Agent')
    if (textBlock.badgeLabel) {
      expect(textBlock.badgeLabel).toBe('@Agent')
      expect(textBlock.badgeVariant).toBe('primary')
    }
  })
})

/* ═══════════════════════════════════════════════════════════════════════
   PIPELINE 3 -- Streaming: Incremental Append => Key Stability
   ══════════════════════════════════════════════════════════════════════ */

describe('Pipeline 3: Streaming -- incremental append => key stability', () => {

  /* -- 3a. Progressive thinking blocks => growing snapshots with stable IDs -- */

  it('3a: thinking blocks accumulate without ID changes', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, content: 'Step 1', isThinking: true },
      { id: 'th2', kind: 'thinking', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, content: 'Step 2', isThinking: true },
      { id: 'th3', kind: 'thinking', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, content: 'Step 3', isThinking: false },
    ] as TranscriptBlock[]

    const snapshots = simulateStreaming(blocks)
    expect(snapshots).toHaveLength(3)

    // Snapshot 1: 1 thinking card
    expect(snapshots[0]).toHaveLength(1)
    const agent1 = snapshots[0]![0] as TranscriptAgentItem
    expect(agent1.rows).toHaveLength(1)

    // Snapshot 2: 2 thinking cards
    expect(snapshots[1]).toHaveLength(1)
    const agent2 = snapshots[1]![0] as TranscriptAgentItem
    expect(agent2.rows).toHaveLength(2)

    // Snapshot 3: 3 thinking cards
    expect(snapshots[2]).toHaveLength(1)
    const agent3 = snapshots[2]![0] as TranscriptAgentItem
    expect(agent3.rows).toHaveLength(3)

    // Agent ID must remain stable
    expect(agent1.id).toBe(agent2.id)
    expect(agent2.id).toBe(agent3.id)
  })

  /* -- 3b. Streaming tool_call => tool_result merges correctly -- */

  it('3b: tool_call arrives, then result merges in streaming snapshots', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, toolName: 'Read', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, toolName: 'Read', status: 'completed', summary: 'done' },
    ] as TranscriptBlock[]

    const snapshots = simulateStreaming(blocks)

    // Snapshot 1: tool_call only => status running
    const rows1 = (snapshots[0]![0] as TranscriptAgentItem).rows
    expect(rows1).toHaveLength(1)
    expect(rows1[0]!.status).toBe('running')
    expect(rows1[0]!.isResult).toBeUndefined()

    // Snapshot 2: tool_result merges => status ok
    const rows2 = (snapshots[1]![0] as TranscriptAgentItem).rows
    expect(rows2).toHaveLength(1)
    expect(rows2[0]!.status).toBe('ok')
    expect(rows2[0]!.isResult).toBe(true)
    expect(rows2[0]!.content).toBe('done')
  })

  /* -- 3c. verifyStreamingKeyStability returns no issues for simple stream -- */

  it('3c: verifyStreamingKeyStability passes for mixed blocks', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, content: 'think', isThinking: true },
      { id: 'tc1', kind: 'tool_call', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, toolName: 'Grep', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, toolName: 'Grep', status: 'completed', summary: 'found' },
    ] as TranscriptBlock[]

    const issues = verifyStreamingKeyStability(blocks)
    expect(issues).toEqual([])
  })

  /* -- 3d. Multiple tool_calls with same toolName => FIFO pairing maintained across snapshots -- */

  it('3d: multiple Read calls => FIFO result pairing stable across streaming', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc_read1', kind: 'tool_call', createdAt: '2026-06-17T14:30:01.000Z', author: { id: 'a1', name: 'Agent', role: 'agent' }, toolName: 'Read', status: 'running', target: '/a.ts' },
      { id: 'tc_read2', kind: 'tool_call', createdAt: '2026-06-17T14:30:02.000Z', author: { id: 'a1', name: 'Agent', role: 'agent' }, toolName: 'Read', status: 'running', target: '/b.ts' },
      { id: 'tr_read1', kind: 'tool_result', createdAt: '2026-06-17T14:30:03.000Z', author: { id: 'a1', name: 'Agent', role: 'agent' }, toolName: 'Read', status: 'completed', summary: 'content A' },
      { id: 'tr_read2', kind: 'tool_result', createdAt: '2026-06-17T14:30:04.000Z', author: { id: 'a1', name: 'Agent', role: 'agent' }, toolName: 'Read', status: 'completed', summary: 'content B' },
    ] as TranscriptBlock[]

    const snapshots = simulateStreaming(blocks)
    expect(snapshots).toHaveLength(4)

    // Final snapshot: 2 merged tool cards (FIFO pairing)
    const finalRows = (snapshots[3]![0] as TranscriptAgentItem).rows
    expect(finalRows).toHaveLength(2)

    // Check both have isResult (both tool_calls matched with results)
    expect(finalRows[0]!.isResult).toBe(true)
    expect(finalRows[1]!.isResult).toBe(true)

    // Key stability
    const issues = verifyStreamingKeyStability(blocks)
    expect(issues).toEqual([])
  })

  /* -- 3e. User text between agent blocks => stable items across snapshots -- */

  it('3e: user message between agent blocks preserves item order in streaming', () => {
    const makeUser = (id: string, text: string) => ({
      id, kind: 'text' as const, createdAt: NOW,
      author: { id: 'user-1', name: 'User', role: 'human' as const },
      text,
    }) as TranscriptBlock
    const makeAgentThink = (id: string, content: string) => ({
      id, kind: 'thinking' as const, createdAt: NOW,
      author: { id: 'a1', name: 'Agent', role: 'agent' as const },
      content, isThinking: true,
    }) as TranscriptBlock

    const blocks: TranscriptBlock[] = [
      makeUser('u1', 'Do task A'),
      makeAgentThink('th1', 'Working on A...'),
      makeUser('u2', 'Also do task B'),
      makeAgentThink('th2', 'Working on B...'),
    ]

    const snapshots = simulateStreaming(blocks)
    expect(snapshots).toHaveLength(4)

    // Final snapshot: user, agent, user, agent
    const items = snapshots[3]!
    expect(items).toHaveLength(4)
    // TranscriptUserItem has type='user'
    expect((items[0] as TranscriptUserItem).type).toBe('user')
    expect((items[0] as TranscriptUserItem).text).toBe('Do task A')
    // TranscriptAgentItem does NOT have a 'type' field -- agent items
    // are discriminated by the presence of 'rows'/'bubbles' fields
    expect('rows' in items[1]!).toBe(true)
    expect((items[2] as TranscriptUserItem).type).toBe('user')
    expect('rows' in items[3]!).toBe(true)

    // Key stability
    const issues = verifyStreamingKeyStability(blocks)
    expect(issues).toEqual([])
  })
})

/* ═══════════════════════════════════════════════════════════════════════
   PIPELINE 4 -- Error Handling: Malformed Blocks => Graceful Degradation
   ══════════════════════════════════════════════════════════════════════ */

describe('Pipeline 4: Error handling -- malformed blocks => graceful degradation', () => {

  /* -- 4a. Null author => defaults to 'unknown' / 'system' -- */

  it('4a: block with null author => does not crash, produces valid output', () => {
    const blocks: TranscriptBlock[] = [
      { id: 't1', kind: 'text', createdAt: NOW, author: null as unknown as TranscriptBlock['author'], text: 'content' },
    ] as TranscriptBlock[]

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    // Null author => role defaults to 'system' => treated as agent bubble
    const agent = items[0] as TranscriptAgentItem
    expect(agent.agent).toBe('Agent')
    expect(agent.role).toBe('system')
  })

  /* -- 4b. Null author with kind 'thinking' => does not crash -- */

  it('4b: thinking block with null author => does not crash, produces valid think row', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: NOW, author: null as unknown as TranscriptBlock['author'], content: 'thinking...', isThinking: true },
    ] as TranscriptBlock[]

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.rows).toHaveLength(1)
    expect(agent.rows[0]!.type).toBe('think')
    expect(agent.rows[0]!.content).toBe('thinking...')
  })

  /* -- 4c. Unknown block kind => silently skipped, no crash -- */

  it('4c: unknown block kind => skipped, surrounding blocks still processed', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, content: 'Before', isThinking: true },
      { id: 'unk1', kind: '__nonexistent_kind__' as unknown as TranscriptBlock['kind'], createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' } },
      { id: 'th2', kind: 'thinking', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, content: 'After', isThinking: true },
    ] as TranscriptBlock[]

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.rows).toHaveLength(2) // only Before + After, unknown skipped
    expect(agent.rows[0]!.content).toBe('Before')
    expect(agent.rows[1]!.content).toBe('After')
  })

  /* -- 4d. Undefined toolName => defaults to 'unknown', no crash -- */

  it('4d: tool_call with undefined toolName => defaults to "unknown", no crash', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, toolName: undefined as unknown as string, status: 'running' },
    ] as TranscriptBlock[]

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.rows).toHaveLength(1)
    expect(agent.rows[0]!.toolName).toBe('unknown')
  })

  /* -- 4e. Undefined content in thinking => empty string content, no crash -- */

  it('4e: thinking with undefined content => empty string content', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, content: undefined, isThinking: true },
    ] as TranscriptBlock[]

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.rows).toHaveLength(1)
    expect(agent.rows[0]!.content).toBe('')
  })

  /* -- 4f. Missing createdAt => empty time string, no crash -- */

  it('4f: block missing createdAt => produces empty time string', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', author: { id: 'a1', name: 'Agent', role: 'agent' }, content: 'a', isThinking: true },
    ] as TranscriptBlock[]

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.time).toBe('')
  })

  /* -- 4g. Edge event with unknown type => null block, filtered out -- */

  it('4g: edge event with unknown type => filtered out, no crash', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: '__undefined_event_type__' as unknown as EventEnvelope['type'],
        payload: { runId: 'run-1', text: 'garbage' },
      }),
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-valid', content: 'Valid text' },
      }),
    ]

    expect(() => normalizeEdgeEventsToTranscript(events)).not.toThrow()
    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks).toHaveLength(1) // unknown event filtered out
    expect(blocks[0]!.kind).toBe('text')

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
  })

  /* -- 4h. Edge event with missing payload fields => null return, filtered out -- */

  it('4h: run.output with empty text => null return, filtered out', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.output',
        payload: { runId: 'run-1', stream: 'stdout' as const, offset: 0, text: '' },
      }),
    ]

    expect(() => normalizeEdgeEventsToTranscript(events)).not.toThrow()
    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks).toHaveLength(0) // empty text => null
  })

  /* -- 4i. Hub message with invalid content JSON => renders as raw string -- */

  it('4i: Hub message with broken JSON content => renders raw string, no crash', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        content: '{ broken json ',
        sender_type: 'user',
      }),
    ]

    expect(() => normalizeHubMessagesToTranscript(msgs)).not.toThrow()
    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    // JSON parse fails => content treated as raw string
    expect((blocks[0]! as TextTranscriptBlock).text).toBe('{ broken json ')

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
  })

  /* -- 4j. Hub message with null content => filtered out gracefully -- */

  it('4j: Hub message with null content => filtered out (empty string), no crash', () => {
    const msgs: HubMessageTranscriptInput[] = [
      hubMsg({
        content: null,
        sender_type: 'user',
      }),
    ]

    expect(() => normalizeHubMessagesToTranscript(msgs)).not.toThrow()
    const blocks = normalizeHubMessagesToTranscript(msgs)
    // renderHubContent(null, undefined):
    //   knownRecord is undefined => skip
    //   typeof null !== 'string' => skip
    //   null && typeof null !== 'object' (null is falsy) => skip
    //   => content == null ? '' : JSON.stringify(content) = ''
    //   => text = '' => !text.trim() = true => return null (filtered out)
    expect(blocks).toHaveLength(0)
  })

  /* -- 4k. Edge event with missing runId => fallback to event.id for evidenceRef -- */

  it('4k: run.agent.text_delta with missing runId => uses event.id fallback, no crash', () => {
    const events: EventEnvelope[] = [
      edgeEvent({
        type: 'run.agent.text_delta',
        id: 'fallback-id-123',
        payload: { content: 'Content without runId' },
      }),
    ]

    expect(() => normalizeEdgeEventsToTranscript(events)).not.toThrow()
    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('text')
    // Should have evidenceRefs with the fallback run ID
    expect(blocks[0]!.evidenceRefs).toBeDefined()
    expect(blocks[0]!.evidenceRefs!.length).toBeGreaterThan(0)

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  /* -- 4l. Empty agent_timeline items array => no blocks produced -- */

  it('4l: agent_timeline with empty items => filtered out, no crash', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tl1', kind: 'agent_timeline', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, items: [] },
    ] as TranscriptBlock[]

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(0)
  })

  /* -- 4m. NaN inputTokens in context_usage => handled gracefully -- */

  it('4m: context_usage with NaN values => does not crash, produces sanitized output', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'cu1', kind: 'context_usage', createdAt: NOW,
        author: { id: 'a1', name: 'Agent', role: 'agent' },
        inputTokens: NaN, outputTokens: NaN, usagePercent: NaN,
      },
    ] as TranscriptBlock[]

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.standaloneRows).toHaveLength(1)
    const row = agent.standaloneRows[0]!
    expect(row.type).toBe('ctx')
    // NaN || 0 = 0
    expect(row.ctxPct).toBe(0)
    // ((NaN || 0) / 1000).toFixed(1) => "0.0k"
    expect(row.ctxStats).toContain('in: 0.0k')
    expect(row.ctxStats).toContain('out: 0.0k')
  })

  /* -- 4n. Extremely long diff patch => truncated to maxLines -- */

  it('4n: diff block with >40 patch lines => truncated to 40 lines', () => {
    const longPatch = Array.from({ length: 100 }, (_, i) => ` line ${i}`).join('\n')
    const blocks: TranscriptBlock[] = [
      {
        id: 'd1', kind: 'diff', createdAt: NOW,
        author: { id: 'a1', name: 'Agent', role: 'agent' },
        title: 'Large diff', files: ['src/big.ts'],
        patch: longPatch,
      },
    ] as TranscriptBlock[]

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    const agent = items[0] as TranscriptAgentItem
    const row = agent.rows[0]!
    expect(row.diffLines).toBeDefined()
    expect(row.diffLines!.length).toBeLessThanOrEqual(40)
  })

  /* -- 4o. Edge event array with only unknown types => empty output -- */

  it('4o: all edge events are unknown types => empty blocks, empty items', () => {
    const events: EventEnvelope[] = [
      edgeEvent({ type: 'unknown.type.one' as unknown as EventEnvelope['type'] }),
      edgeEvent({ type: 'unknown.type.two' as unknown as EventEnvelope['type'] }),
    ]

    const blocks = normalizeEdgeEventsToTranscript(events)
    expect(blocks).toHaveLength(0)

    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(0)
  })

  /* -- 4p. Mixed valid and invalid blocks => valid blocks still processed -- */

  it('4p: mix of valid and malformed blocks => valid blocks produce correct output', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'valid1', kind: 'thinking', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, content: 'Valid think', isThinking: true },
      { id: 'malformed', kind: '__bad__' as unknown as TranscriptBlock['kind'], createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' } },
      { id: 'valid2', kind: 'thinking', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, content: 'Also valid', isThinking: true },
    ] as TranscriptBlock[]

    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as TranscriptAgentItem
    expect(agent.rows).toHaveLength(2)
    expect(agent.rows[0]!.content).toBe('Valid think')
    expect(agent.rows[1]!.content).toBe('Also valid')
  })

  /* -- 4q. Structural invariant: every TranscriptAgentItem has a non-empty id -- */

  it('4q: structural invariant -- all TranscriptAgentItems have non-empty ids', () => {
    // This test verifies that no matter the input, the adapter never
    // produces agent items with empty/null/undefined ids, which would
    // break React reconciliation.
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', author: undefined as unknown as TranscriptBlock['author'], content: 'x', isThinking: true },
    ] as TranscriptBlock[]

    const items = blocksToTranscriptItems(blocks)
    for (const item of items) {
      if (isTranscriptAgentItem(item)) {
        expect(item.id).toBeTruthy()
        expect(typeof item.id).toBe('string')
      }
    }
  })

  /* -- 4r. Structural invariant: all RowItems have id and type -- */

  it('4r: structural invariant -- all RowItems have non-empty id and valid type', () => {
    const validRowTypes = new Set(['think', 'tool', 'file', 'sub', 'approval', 'route', 'deploy', 'attachment', 'ctx', 'session'])

    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, content: 'x', isThinking: false },
      { id: 'tc1', kind: 'tool_call', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, toolName: 'Read', status: 'completed' },
      { id: 'rd1', kind: 'route_decision', createdAt: NOW, author: { id: 'a1', name: 'Agent', role: 'agent' }, action: 'delegate', summary: 'go' },
    ] as TranscriptBlock[]

    const items = blocksToTranscriptItems(blocks)
    for (const item of items) {
      if ('rows' in item) {
        const agent = item as TranscriptAgentItem
        for (const row of agent.rows) {
          expect(row.id).toBeTruthy()
          expect(validRowTypes.has(row.type)).toBe(true)
        }
        for (const row of agent.standaloneRows) {
          expect(row.id).toBeTruthy()
          expect(validRowTypes.has(row.type)).toBe(true)
        }
      }
    }
  })

  /* -- 4s. Malformed edge event payload => normalized gracefully by edge normalizer -- */

  it('4s: edge event with undefined payload fields => normalizer handles missing fields', () => {
    const events: EventEnvelope[] = [
      {
        version: '1.0',
        id: 'evt-minimal',
        seq: 1,
        type: 'run.agent.tool_call',
        scope: {},
        sentAt: NOW,
        payload: {},
      },
    ]

    expect(() => normalizeEdgeEventsToTranscript(events)).not.toThrow()
    const blocks = normalizeEdgeEventsToTranscript(events)
    // tool_call without toolName or callId => null (filtered out)
    expect(blocks).toHaveLength(0)
  })

  /* -- 4t. Hub message with all null/undefined sender => defaults applied -- */

  it('4t: Hub message with no sender info => defaults without crash', () => {
    const msgs: HubMessageTranscriptInput[] = [
      {
        id: 'anon-msg',
        content: { text: 'Anonymous message' },
      },
    ]

    expect(() => normalizeHubMessagesToTranscript(msgs)).not.toThrow()
    const blocks = normalizeHubMessagesToTranscript(msgs)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.author).toBeDefined()
    expect(blocks[0]!.author.name).toBeDefined()
    // Default: role='human', name='???'
    expect(blocks[0]!.author.role).toBe('human')
  })
})

/* ═══════════════════════════════════════════════════════════════════════
   CROSS-PIPELINE -- Edge + Hub data mixed in same transcript
   ══════════════════════════════════════════════════════════════════════ */

describe('Cross-pipeline: Edge + Hub blocks mixed in same TranscriptItem[]', () => {

  it('cross-1: edge agent text + hub user text => interleaved user + agent items', () => {
    // Step 1: produce Hub user text
    const hubBlocks = normalizeHubMessagesToTranscript([
      hubMsg({
        content: { text: 'User message from Hub' },
        sender_type: 'user',
        sender_id: 'user-1',
        sender: { nickname: 'User' },
      }),
    ])

    // Step 2: produce Edge agent text (different author: AGENT_AUTHOR id='agent')
    const edgeBlocks = normalizeEdgeEventsToTranscript([
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-1', content: 'Agent reply from Edge' },
      }),
    ])

    // Step 3: combine in order: Hub user text (human author), then Edge agent text (agent author)
    const combined: TranscriptBlock[] = [
      ...hubBlocks,
      ...edgeBlocks,
    ]

    const items = blocksToTranscriptItems(combined)
    // Human-role text block => TranscriptUserItem
    // Agent-role text block => TranscriptAgentItem
    expect(items).toHaveLength(2)
    expect((items[0] as TranscriptUserItem).type).toBe('user')
    expect((items[0] as TranscriptUserItem).text).toBe('User message from Hub')
    // Agent items don't have .type, check for 'bubbles' / 'rows'
    expect('bubbles' in items[1]!).toBe(true)
    expect((items[1] as TranscriptAgentItem).bubbles).toContain('Agent reply from Edge')
  })

  it('cross-2: edge thinking + hub system notification => both in transcript', () => {
    const hubBlocks = normalizeHubMessagesToTranscript([
      hubMsg({
        content: { text: 'System: deployment started' },
        sender_type: 'system',
      }),
    ])

    const edgeBlocks = normalizeEdgeEventsToTranscript([
      edgeEvent({
        type: 'run.agent.thinking',
        payload: { runId: 'run-1', content: 'Analyzing request...' },
      }),
    ])

    const combined: TranscriptBlock[] = [...hubBlocks, ...edgeBlocks]

    expect(() => blocksToTranscriptItems(combined)).not.toThrow()
    const items = blocksToTranscriptItems(combined)

    // Hub system (author id='hub-system') + Edge agent (author id='agent')
    // => two items (different author ids)
    expect(items.length).toBeGreaterThanOrEqual(2)

    // Verify structural invariants hold for cross-pipeline output
    for (const item of items) {
      if (isTranscriptAgentItem(item)) {
        expect(item.id).toBeTruthy()
      }
    }
  })

  it('cross-3: cross-pipeline structural invariants hold for full mixed transcript', () => {
    // Build a comprehensive mix of Edge + Hub blocks
    const hubBlocks = normalizeHubMessagesToTranscript([
      hubMsg({
        content: { text: 'Task request' },
        sender_type: 'user',
        sender_id: 'user-1',
        sender: { nickname: 'User' },
      }),
    ])

    const edgeBlocks = normalizeEdgeEventsToTranscript([
      edgeEvent({
        type: 'run.agent.thinking',
        payload: { runId: 'run-1', content: 'I will read the file...' },
      }),
      edgeEvent({
        type: 'run.agent.tool_call',
        payload: { runId: 'run-1', toolName: 'Read', callId: 'c1', status: 'running' },
      }),
      edgeEvent({
        type: 'run.agent.tool_result',
        payload: { runId: 'run-1', toolName: 'Read', callId: 'c1', status: 'completed', content: 'File contents here' },
      }),
      edgeEvent({
        type: 'run.agent.text_delta',
        payload: { runId: 'run-1', content: 'The file shows...' },
      }),
    ])

    const combined: TranscriptBlock[] = [...hubBlocks, ...edgeBlocks]

    expect(() => blocksToTranscriptItems(combined)).not.toThrow()
    const items = blocksToTranscriptItems(combined)

    // User item first, then agent items
    expect((items[0] as TranscriptUserItem).type).toBe('user')

    // All agent items should have valid ids and rows
    for (const item of items) {
      if (isTranscriptAgentItem(item)) {
        expect(typeof item.id).toBe('string')
        expect(item.id.length).toBeGreaterThan(0)
        const allRows = [...item.rows, ...item.standaloneRows]
        for (const row of allRows) {
          expect(typeof row.id).toBe('string')
          expect(row.id.length).toBeGreaterThan(0)
          expect(row.type).toBeTruthy()
        }
      }
    }
  })
})
