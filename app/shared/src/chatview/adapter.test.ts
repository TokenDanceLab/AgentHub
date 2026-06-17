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
    expect(rows![0]!.status).toBe('running')
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

  // ── diff block mapping ──
  it('maps diff block to file RowItem with stats and patch', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'd1', kind: 'diff', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Merge PR #42', files: ['src/utils.ts'], additions: 10, deletions: 3,
        patch: '+ added line\n- removed line',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('file')
    expect(row.fileOp).toBe('mod')
    expect(row.label).toBe('Merge PR #42')
    expect(row.extra).toBe('src/utils.ts')
    expect(row.content).toContain('TS')
    expect(row.content).toContain('+10')
    expect(row.content).toContain('-3')
    expect(row.diffLines).toHaveLength(2)
    expect(row.diffLines![0]).toMatchObject({ type: 'add' })
    expect(row.diffLines![1]).toMatchObject({ type: 'del' })
  })

  it('maps diff block with no files gracefully', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'd2', kind: 'diff', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Empty diff', files: [],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('file')
    expect(row.content).toBe('')
  })

  // ── artifact block mapping ──
  it('maps artifact block to file RowItem with extra metadata', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'a1', kind: 'artifact', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'report.pdf', artifactKind: 'document', path: '/tmp/report.pdf',
        uri: 's3://bucket/report.pdf', mimeType: 'application/pdf',
        action: 'created',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('file')
    expect(row.fileOp).toBe('cr')
    expect(row.content).toBe('PDF')
    expect(row.extra).toContain('/tmp/report.pdf')
    expect(row.extra).toContain('s3://bucket/report.pdf')
    expect(row.extra).toContain('application/pdf')
  })

  it('maps artifact with deleted action', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'a2', kind: 'artifact', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'obsolete.ts', action: 'deleted',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.fileOp).toBe('del')
    expect(row.content).toBe('TS')
  })

  it('maps artifact with no path using artifactKind as content fallback', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'a3', kind: 'artifact', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'My Artifact', artifactKind: 'image',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // title has no dot-extension; content falls back to artifactKind
    expect(row.content).toBe('image')
  })

  // ── run_session block mapping ──
  it('maps run_session to standalone session RowItem', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'rs1', kind: 'run_session', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Background check', status: 'completed',
        agentLabel: 'WorkerAgent', runtimeLabel: 'Node 22', meta: '25s',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const standalone = (items[0] as AgentTranscriptBlock).standaloneRows!
    expect(standalone).toHaveLength(1)
    const row = standalone[0]!
    expect(row.type).toBe('session')
    expect(row.label).toBe('Background check')
    expect(row.status).toBe('ok')
    expect(row.standalone).toBe(true)
    expect(row.sessionTags).toContain('Agent: WorkerAgent')
    expect(row.sessionTags).toContain('Runtime: Node 22')
    expect(row.sessionTags).toContain('25s')
  })

  it('maps run_session with running status', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'rs2', kind: 'run_session', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'In progress', status: 'running',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('running')
  })

  // ── subagent/subtask/child_agent mapping ──
  it('maps subagent block to sub RowItem', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'sa1', kind: 'subagent', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Code Review', worker: 'reviewer-agent', status: 'completed', summary: 'Found 3 issues',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('sub')
    expect(row.label).toContain('reviewer-agent')
    expect(row.status).toBe('ok')
    expect(row.content).toBe('Found 3 issues')
  })

  it('maps subtask block to sub RowItem', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'st1', kind: 'subtask', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Unit tests', worker: 'test-runner', status: 'running', summary: 'Running vitest...',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('sub')
    expect(row.label).toContain('test-runner')
    expect(row.status).toBe('running')
  })

  it('maps child_agent block to sub RowItem using agent name', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'ca1', kind: 'child_agent', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Child task', agent: 'worker-7', status: 'completed',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('sub')
    expect(row.label).toContain('worker-7')
    expect(row.status).toBe('ok')
  })

  it('maps subagent with failed status', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'sa2', kind: 'subagent', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Failed task', worker: 'broken', status: 'failed', summary: 'Crash',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('sub')
    expect(row.status).toBe('fail')
  })

  // ── route_decision mapping ──
  it('maps route_decision to standalone route RowItem', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'rd1', kind: 'route_decision', createdAt: makeTime(1), author: makeAuthor('b1'),
        action: 'delegate', summary: 'Routing to specialist agent',
        targetAgent: 'code-reviewer',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const standalone = (items[0] as AgentTranscriptBlock).standaloneRows!
    expect(standalone).toHaveLength(1)
    const row = standalone[0]!
    expect(row.type).toBe('route')
    expect(row.label).toBe('delegate')
    expect(row.status).toBe('ok')
    expect(row.standalone).toBe(true)
    expect(row.content).toBe('Routing to specialist agent')
  })

  // ── context_usage mapping ──
  it('maps context_usage to standalone ctx RowItem with token stats', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'cu1', kind: 'context_usage', createdAt: makeTime(1), author: makeAuthor('b1'),
        inputTokens: 45000, outputTokens: 2300, usagePercent: 72,
        contextLimit: 64000, cachePercent: 35, cost: '$0.12', modelLabel: 'sonnet-4',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const standalone = (items[0] as AgentTranscriptBlock).standaloneRows!
    expect(standalone).toHaveLength(1)
    const row = standalone[0]!
    expect(row.type).toBe('ctx')
    expect(row.status).toBe('ok')
    expect(row.standalone).toBe(true)
    expect(row.ctxPct).toBe(72)
    expect(row.ctxStats).toContain('in: 45.0k')
    expect(row.ctxStats).toContain('out: 2.3k')
    expect(row.ctxStats).toContain('limit: 64k')
    expect(row.ctxStats).toContain('cache: 35%')
    expect(row.ctxStats).toContain('$0.12')
    expect(row.ctxStats).toContain('sonnet-4')
  })

  it('maps context_usage with zero percent gracefully', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'cu2', kind: 'context_usage', createdAt: makeTime(1), author: makeAuthor('b1'),
        inputTokens: 0, outputTokens: 0, usagePercent: 0,
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.ctxPct).toBe(0)
  })

  // ── deploy mapping ──
  it('maps deploy to standalone deploy RowItem with metadata', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'dp1', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'),
        runId: 'run-42', artifactId: 'artifact-7', path: '/dist/app.js',
        deployType: 'static-site', status: 'deployed', url: 'https://app.example.com',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const standalone = (items[0] as AgentTranscriptBlock).standaloneRows!
    expect(standalone).toHaveLength(1)
    const row = standalone[0]!
    expect(row.type).toBe('deploy')
    expect(row.status).toBe('ok')
    expect(row.standalone).toBe(true)
    expect(row.url).toBe('https://app.example.com')
    expect(row.deployMeta).toContain('deployed')
    expect(row.deployMeta).toContain('static-site')
    expect(row.deployMeta).toContain('/dist/app.js')
    expect(row.deployMeta).toContain('artifact-7')
  })

  it('maps deploy with pending status to running', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'dp2', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'),
        runId: 'run-1', status: 'pending',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('running')
  })

  it('maps deploy with deploying status to running', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'dp3', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'),
        runId: 'run-2', status: 'deploying',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('running')
  })

  it('maps deploy with failed status to fail', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'dp4', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'),
        runId: 'run-3', status: 'failed',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('fail')
  })

  it('maps deploy with no metadata parts to default deployMeta', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'dp5', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'),
        runId: 'run-99',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.deployMeta).toBe('Deployed')
  })

  // ── attachment mapping ──
  it('maps attachment to standalone attachment RowItem', () => {
    const attachmentRef = { id: 'att-1', name: 'screenshot.png', size: 204800, mime_type: 'image/png' }
    const blocks: TranscriptBlock[] = [
      {
        id: 'at1', kind: 'attachment', createdAt: makeTime(1), author: makeAuthor('b1'),
        attachmentRef, contentType: 'image',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const standalone = (items[0] as AgentTranscriptBlock).standaloneRows!
    expect(standalone).toHaveLength(1)
    const row = standalone[0]!
    expect(row.type).toBe('attachment')
    expect(row.label).toBe('screenshot.png')
    expect(row.extra).toBe('image')
    expect(row.status).toBe('ok')
    expect(row.standalone).toBe(true)
    expect(row.fileName).toBe('screenshot.png')
    expect(row.fileSize).toBe('200 KB')
  })

  it('maps attachment without size omits fileSize', () => {
    const attachmentRef = { id: 'att-2', name: 'data.bin', size: 0, mime_type: 'application/octet-stream' }
    const blocks: TranscriptBlock[] = [
      {
        id: 'at2', kind: 'attachment', createdAt: makeTime(1), author: makeAuthor('b1'),
        attachmentRef, contentType: 'file',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.fileSize).toBeUndefined()
  })

  // ── failure mapping ──
  it('maps failure to think RowItem with fail status', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'f1', kind: 'failure', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Task crashed', reason: 'OOM killed after 45s',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('think')
    expect(row.status).toBe('fail')
    expect(row.content).toBe('OOM killed after 45s')
  })

  it('maps failure with no reason to title fallback', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'f2', kind: 'failure', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Unknown error',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.content).toBe('Unknown error')
  })

  it('maps failure with no reason or title to default Chinese message', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'f3', kind: 'failure', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: '',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.content).toBe('运行失败')
  })

  // ── agent_timeline flattening ──
  it('flattens agent_timeline items into think RowItems', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [
          { label: 'Load config', detail: 'Loaded 12 entries', status: 'completed' },
          { label: 'Connect DB', detail: 'Connected in 300ms', status: 'completed' },
          { label: 'Run migration', status: 'running' },
        ],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows!
    expect(rows).toHaveLength(3)
    expect(rows[0]!.type).toBe('think')
    expect(rows[0]!.status).toBe('ok')
    expect(rows[0]!.content).toBe('Load config: Loaded 12 entries')
    expect(rows[1]!.status).toBe('ok')
    expect(rows[2]!.status).toBe('running')
    expect(rows[2]!.content).toBe('Run migration: ')
  })

  it('maps agent_timeline with failed items to fail status', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl2', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [
          { label: 'Deploy', status: 'failed' },
        ],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('fail')
  })

  it('handles agent_timeline with empty items array', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl3', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows!
    expect(rows).toHaveLength(0)
  })

  // ── permission_request / permission_result ──
  it('maps permission_request to standalone approval RowItem with waiting status', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'pr1', kind: 'permission_request', createdAt: makeTime(1), author: makeAuthor('b1'),
        requestId: 'req-1', title: 'Allow file write', status: 'pending',
        toolName: 'Write', risk: 'medium', reason: 'Writing to /etc/config',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const standalone = (items[0] as AgentTranscriptBlock).standaloneRows!
    expect(standalone).toHaveLength(1)
    const row = standalone[0]!
    expect(row.type).toBe('approval')
    expect(row.status).toBe('waiting')
    expect(row.standalone).toBe(true)
    expect(row.apReason).toContain('Write')
    expect(row.apReason).toContain('medium')
    expect(row.apReason).toContain('Writing to /etc/config')
  })

  it('maps permission_result to standalone approval RowItem', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'pr2', kind: 'permission_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        requestId: 'req-1', title: 'Allow file write', status: 'completed',
        decision: 'allow', toolName: 'Write', reason: 'Approved by user',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const standalone = (items[0] as AgentTranscriptBlock).standaloneRows!
    expect(standalone).toHaveLength(1)
    const row = standalone[0]!
    expect(row.type).toBe('approval')
    expect(row.status).toBe('ok')
    // permission_result uses statusNorm (not forced waiting)
    expect(row.apReason).toContain('Write')
  })

  it('maps permission_result with failed status', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'pr3', kind: 'permission_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        requestId: 'req-2', title: 'Permission denied', status: 'failed',
        decision: 'deny', toolName: 'Bash',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('fail')
  })

  // ── orphan tool_result (no matching tool_call) ──
  it('creates standalone tool RowItem for orphan tool_result with no matching tool_call', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tr1', kind: 'tool_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: 'Bash', status: 'completed', summary: 'Command output...',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows!
    expect(rows).toHaveLength(1)
    expect(rows[0]!.type).toBe('tool')
    expect(rows[0]!.toolName).toBe('bash')
    expect(rows[0]!.isResult).toBe(true)
    expect(rows[0]!.status).toBe('ok')
    expect(rows[0]!.content).toBe('Command output...')
  })

  it('merges tool_result with matching tool_call even when non-adjacent', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Grep', status: 'running' },
      { id: 'tc2', kind: 'tool_call', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(3), author: makeAuthor('b1'), toolName: 'Grep', status: 'completed', summary: 'found matches' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows!
    expect(rows).toHaveLength(2) // Read (running) + Grep (merged to ok)
    expect(rows[0]!.toolName).toBe('read')
    expect(rows[1]!.toolName).toBe('grep')
    expect(rows[1]!.isResult).toBe(true)
    expect(rows[1]!.status).toBe('ok')
  })

  it('stores orphan tool_result as new row when toolName differs from all tool_calls', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
      { id: 'tr2', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Bash', status: 'completed', summary: 'done' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows!
    expect(rows).toHaveLength(2)
    expect(rows[0]!.toolName).toBe('read')
    expect(rows[0]!.isResult).toBeUndefined()
    expect(rows[1]!.toolName).toBe('bash')
    expect(rows[1]!.isResult).toBe(true)
  })

  // ── mixed standalone card routing ──
  it('routes standalone cards to standaloneRows and inline cards to rows', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
      { id: 'rd1', kind: 'route_decision', createdAt: makeTime(2), author: makeAuthor('b1'), action: 'delegate', summary: 'routing...' },
      { id: 'th1', kind: 'thinking', createdAt: makeTime(3), author: makeAuthor('b1'), content: 'checking...', isThinking: true },
      { id: 'cu1', kind: 'context_usage', createdAt: makeTime(4), author: makeAuthor('b1'), inputTokens: 1000, outputTokens: 500 },
      { id: 'dp1', kind: 'deploy', createdAt: makeTime(5), author: makeAuthor('b1'), runId: 'r1', status: 'deployed' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const agent = items[0] as AgentTranscriptBlock
    // Inline rows: tool_call + thinking
    expect(agent.rows).toHaveLength(2)
    expect(agent.rows[0]!.type).toBe('tool')
    expect(agent.rows[1]!.type).toBe('think')
    // Standalone rows: route_decision + context_usage + deploy
    expect(agent.standaloneRows).toHaveLength(3)
    const types = (agent.standaloneRows!).map(r => r.type)
    expect(types).toEqual(['route', 'ctx', 'deploy'])
  })

  it('routes approval and session and attachment to standaloneRows', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'ap1', kind: 'approval', createdAt: makeTime(1), author: makeAuthor('b1'), title: 'Confirm', status: 'pending' },
      { id: 'rs1', kind: 'run_session', createdAt: makeTime(2), author: makeAuthor('b1'), title: 'Session 1' },
      {
        id: 'at1', kind: 'attachment', createdAt: makeTime(3), author: makeAuthor('b1'),
        attachmentRef: { id: 'a1', name: 'file.txt', size: 100, mime_type: 'text/plain' },
        contentType: 'file',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.rows).toHaveLength(0)
    expect(agent.standaloneRows).toHaveLength(3)
    const types = (agent.standaloneRows!).map(r => r.type)
    expect(types).toEqual(['approval', 'session', 'attachment'])
  })
})
