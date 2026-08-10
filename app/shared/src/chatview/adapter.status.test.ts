import { describe, it, expect } from 'vitest'
import { blocksToTranscriptItems, resolveUnreadAnchorItemIndex } from './adapter'
import type { AgentTranscriptBlock } from './index'
import type { TranscriptBlock } from '../transcript/types'
import { makeAuthor, makeUser, makeTime } from './adapter-test-helpers'

describe('blocksToTranscriptItems (status variants)', () => {
  // RowItem.status: 'running' | 'ok' | 'fail' | 'waiting'
  // ═══════════════════════════════════════════════════════════════════════

  // ── think (thinking block) status variants ──
  // think status is: isThinking ? 'running' : 'ok' (binary, not all 4)
  it('think status: running (isThinking=true)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'x', isThinking: true },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('running')
  })

  it('think status: ok (isThinking=false)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'x', isThinking: false },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('ok')
  })

  // think via failure: always fail
  it('think status via failure: fail', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'f1', kind: 'failure', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'Error', reason: 'boom' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('think')
    expect(row.status).toBe('fail')
  })

  // think via agent_timeline items: all 4 statuses
  it('think status via agent_timeline: running (generic fallback)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [{ label: 'Step', status: 'running' }] },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('think')
    expect(row.status).toBe('running')
  })

  it('think status via agent_timeline: ok (completed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [{ label: 'Step', status: 'completed' }] },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('ok')
  })

  it('think status via agent_timeline: ok (done)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [{ label: 'Step', status: 'done' }] },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('ok')
  })

  it('think status via agent_timeline: fail (failed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [{ label: 'Step', status: 'failed' }] },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('fail')
  })

  it('think status via agent_timeline: waiting (todo)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [{ label: 'Step', status: 'todo' }] },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('waiting')
  })

  // ── tool status variants ──
  // tool_call: running | ok | fail (no waiting)
  it('tool status: running (tool_call with running status)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('tool')
    expect(row.status).toBe('running')
  })

  it('tool status: ok (tool_call with completed status)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'completed' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('ok')
  })

  it('tool status: fail (tool_call with failed status)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'failed' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('fail')
  })

  // tool_result: statusNorm: running | ok | fail (no waiting path)
  it('tool status: running (tool_result with pending status)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'pending', summary: '...' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('running')
  })

  it('tool status: ok (tool_result with completed status)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'done' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('ok')
  })

  it('tool status: fail (tool_result with failed status)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'failed', summary: 'error' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('fail')
  })

  // ── file status variants ──
  // file_change, artifact, diff: always 'ok' (no status field on input)
  it('file status via file_change: always ok', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'fc1', kind: 'file_change', createdAt: makeTime(1), author: makeAuthor('b1'), path: 'src/x.ts', action: 'modified' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('file')
    expect(row.status).toBe('ok')
  })

  it('file status via artifact: always ok', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'a1', kind: 'artifact', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'f.pdf', action: 'created' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('ok')
  })

  it('file status via diff: always ok', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'd1', kind: 'diff', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'PR #1', files: ['src/x.ts'] },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('ok')
  })

  // ── sub status variants (subagent / subtask / child_agent) ──
  // Uses statusNorm: running | ok | fail (no waiting)
  it('sub status: running (status=pending)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'sa1', kind: 'subagent', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'T', worker: 'w', status: 'pending' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('sub')
    expect(row.status).toBe('running')
  })

  it('sub status: running (status=running)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'sa1', kind: 'subagent', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'T', worker: 'w', status: 'running' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('running')
  })

  it('sub status: ok (status=completed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'sa1', kind: 'subagent', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'T', worker: 'w', status: 'completed' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('ok')
  })

  it('sub status: fail (status=failed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'sa1', kind: 'subagent', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'T', worker: 'w', status: 'failed' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('fail')
  })

  // ── approval status variants ──
  // approval: statusNorm → running | ok | fail
  // permission_request: always 'waiting'
  // permission_result: statusNorm → running | ok | fail
  it('approval status: running (status=pending)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'ap1', kind: 'approval', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'Confirm', status: 'pending' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.type).toBe('approval')
    expect(row.status).toBe('running')
  })

  it('approval status: ok (status=completed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'ap1', kind: 'approval', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'Done', status: 'completed' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('ok')
  })

  it('approval status: fail (status=failed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'ap1', kind: 'approval', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'Denied', status: 'failed' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('fail')
  })

  it('approval status via permission_request: waiting', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'pr1', kind: 'permission_request', createdAt: makeTime(1), author: makeAuthor('b1'),
        requestId: 'req-1', title: 'Allow', status: 'pending', toolName: 'Write' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.type).toBe('approval')
    expect(row.status).toBe('waiting')
  })

  it('approval status via permission_result: running (pending)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'pr2', kind: 'permission_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        requestId: 'req-1', title: 'Allow', status: 'pending', decision: 'allow' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('running')
  })

  it('approval status via permission_result: ok (completed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'pr2', kind: 'permission_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        requestId: 'req-1', title: 'Allow', status: 'completed', decision: 'allow' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('ok')
  })

  it('approval status via permission_result: fail (failed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'pr2', kind: 'permission_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        requestId: 'req-1', title: 'Denied', status: 'failed', decision: 'deny' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('fail')
  })

  // ── session status variants ──
  // run_session: statusNorm (input status: running | completed | failed | undefined)
  it('session status: running', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'rs1', kind: 'run_session', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'Active', status: 'running' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.type).toBe('session')
    expect(row.status).toBe('running')
  })

  it('session status: ok (completed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'rs1', kind: 'run_session', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'Done', status: 'completed' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('ok')
  })

  it('session status: fail (failed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'rs1', kind: 'run_session', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'Crashed', status: 'failed' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('fail')
  })

  it('session status: ok (undefined status defaults)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'rs1', kind: 'run_session', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'No status' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    // statusNorm(undefined) → 'running', but run_session passes r.status || 'completed'
    // so statusNorm('completed') → 'ok'
    expect(row.status).toBe('ok')
  })

  // ── deploy status variants ──
  // deployStatusNorm: running | ok | fail
  it('deploy status: running (pending)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'dp1', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'), runId: 'r1', status: 'pending' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.type).toBe('deploy')
    expect(row.status).toBe('running')
  })

  it('deploy status: running (deploying)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'dp1', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'), runId: 'r1', status: 'deploying' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('running')
  })

  it('deploy status: ok (deployed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'dp1', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'), runId: 'r1', status: 'deployed' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('ok')
  })

  it('deploy status: ok (ready)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'dp1', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'), runId: 'r1', status: 'ready' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('ok')
  })

  it('deploy status: ok (no status)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'dp1', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'), runId: 'r1' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    // deployStatusNorm(undefined) → 'ok'
    expect(row.status).toBe('ok')
  })

  it('deploy status: fail (failed)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'dp1', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'), runId: 'r1', status: 'failed' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('fail')
  })

  // ── route status: always ok ──
  it('route status: always ok', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'rd1', kind: 'route_decision', createdAt: makeTime(1), author: makeAuthor('b1'), action: 'delegate', summary: 'go' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.type).toBe('route')
    expect(row.status).toBe('ok')
  })

  // ── ctx status: always ok ──
  it('ctx status: always ok', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'cu1', kind: 'context_usage', createdAt: makeTime(1), author: makeAuthor('b1'), inputTokens: 100, outputTokens: 50 },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.type).toBe('ctx')
    expect(row.status).toBe('ok')
  })

  // ── attachment status: always ok ──
  it('attachment status: always ok', () => {
    const attachmentRef = { id: 'att-1', name: 'f.txt', size: 100, mime_type: 'text/plain' }
    const blocks: TranscriptBlock[] = [
      { id: 'at1', kind: 'attachment', createdAt: makeTime(1), author: makeAuthor('b1'), attachmentRef, contentType: 'file' },
    ] as TranscriptBlock[]
    const row = (blocksToTranscriptItems(blocks)[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.type).toBe('attachment')
    expect(row.status).toBe('ok')
  })
})

describe('resolveUnreadAnchorItemIndex (T8 desktop IM unread divider)', () => {
  const text = (id: string, role: 'agent' | 'human', authorId: string, timeOffset = 0) => ({
    id,
    kind: 'text' as const,
    createdAt: makeTime(timeOffset),
    author: role === 'agent' ? makeAuthor(authorId) : makeUser(authorId),
    text: 'msg ' + id,
  })

  it('returns -1 without a descriptor or when count is zero', () => {
    const blocks = [text('b1', 'human', 'alice')] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(resolveUnreadAnchorItemIndex(blocks, items, undefined)).toBe(-1)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { count: 0 })).toBe(-1)
  })

  it('places the divider above a user-message anchor (1:1 blocks/items)', () => {
    const blocks = [
      text('m1', 'human', 'alice', 0),
      text('m2', 'human', 'alice', 1),
      text('m3', 'human', 'alice', 2),
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'm3', count: 1 })).toBe(2)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'm2', count: 2 })).toBe(1)
  })

  it('treats a merged agent group as the item containing the anchor block', () => {
    const blocks = [
      text('u1', 'human', 'alice', 0),
      text('a1', 'agent', 'bob', 1),
      text('a2', 'agent', 'bob', 2),
      text('a3', 'agent', 'bob', 3),
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(2) // user + one merged agent group
    // Anchor mid-group → divider above the whole group (index 1).
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'a2', count: 2 })).toBe(1)
    // Anchor at the group start → same result.
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'a1', count: 3 })).toBe(1)
  })

  it('anchors a second same-author group after a user message', () => {
    const blocks = [
      text('a1', 'agent', 'bob', 0),
      text('u1', 'human', 'alice', 1),
      text('a2', 'agent', 'bob', 2),
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(3)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'a2', count: 1 })).toBe(2)
  })

  it('falls back to the unread tail count when the anchor block is missing', () => {
    const blocks = [
      text('m1', 'human', 'alice', 0),
      text('m2', 'human', 'alice', 1),
      text('m3', 'human', 'alice', 2),
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    // Anchor was filtered out upstream → place before the last `count` items.
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'ghost', count: 2 })).toBe(1)
    expect(resolveUnreadAnchorItemIndex(blocks, items, { anchorBlockId: 'ghost', count: 99 })).toBe(0)
  })
})
