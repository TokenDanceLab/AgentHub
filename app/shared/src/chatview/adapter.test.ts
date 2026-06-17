/* ═══════════════════════════════════════════════════════════════════════
   ADAPTER TESTS — blocksToTranscriptItems() contract validation
   ══════════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest'
import { blocksToTranscriptItems } from './adapter'
import type { AgentTranscriptBlock } from './index'
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
      { id: 'u1', kind: 'text', createdAt: makeTime(0), author: makeUser('alice'), text: 'hello' },
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

  it('maps preview block to standalone preview RowItem', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'p1', kind: 'preview', createdAt: makeTime(1), author: makeAuthor('b1'), previewId: 'prev-1', url: 'https://example.com/docs/report.html', status: 'completed' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.standaloneRows).toHaveLength(1)
    expect(agent.rows).toHaveLength(0)
    const row = agent.standaloneRows![0]!
    expect(row.type).toBe('preview')
    expect(row.status).toBe('ok')
    expect(row.url).toBe('https://example.com/docs/report.html')
    expect(row.previewDomain).toBe('example.com')
    expect(row.previewTitle).toBe('report')
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
      { id: 'u1', kind: 'text', createdAt: makeTime(0), author: makeUser('alice'), text: 'do X' },
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'ok', isThinking: true },
      { id: 'u2', kind: 'text', createdAt: makeTime(2), author: makeUser('alice'), text: 'also do Y' },
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
    // When path is undefined and title has no dot extension,
    // content falls back to artifactKind
    const blocks: TranscriptBlock[] = [
      {
        id: 'a3', kind: 'artifact', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'My Artifact', artifactKind: 'image',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // title "My Artifact" has no dot; split returns ["My Artifact"],
    // pop returns "My Artifact" which is truthy, so artifactKind fallback is not reached.
    expect(row.content).toBe('MY ARTIFACT')
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
    // Empty items array produces no rows and no agent block
    expect(items).toHaveLength(0)
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
    expect(rows).toHaveLength(2) // Grep (merged to ok) + Read (running)
    // findLastIndex matches the last tool_call with same toolName; Grep result replaces the Grep tool_call at index 0
    expect(rows[0]!.toolName).toBe('grep')
    expect(rows[0]!.isResult).toBe(true)
    expect(rows[0]!.status).toBe('ok')
    expect(rows[1]!.toolName).toBe('read')
    expect(rows[1]!.isResult).toBeUndefined()
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

  // ═══════════════════════════════════════════════════════════════════════
  // BUG HUNT — failing tests for bugs found in adapter.ts
  // ═══════════════════════════════════════════════════════════════════════

  // ── BUG: tool_call with status failed shows as running ──
  it('BUG: tool_call with status=failed should show as fail, not running', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'failed' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('tool')
    // BUG: currently returns 'running', should be 'fail'
    expect(row.status).toBe('fail')
  })

  // ── BUG: tool_call with status=failed but completed evidenceRef incorrectly shows as ok ──
  it('BUG: tool_call with status=failed should stay fail even with completed evidenceRefs', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: 'Read', status: 'failed',
        evidenceRefs: [{ id: 'er1', kind: 'tool' as const, label: 'Logs', status: 'completed' as const }],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // BUG: evidenceRefs completion overrides the explicit failed status
    // The failed block status should take precedence over evidence refs
    expect(row.status).toBe('fail')
  })

  // ── BUG: approval 'reason in a' check never falls through to title ──
  it('BUG: approval block should use title when reason is undefined', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'ap1', kind: 'approval', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Deploy to production', status: 'pending',
        // reason not set — should fall back to title in apReason
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // BUG: 'reason' in a is always true (property exists on the interface),
    // so a.reason (undefined) is used, filtered out by Boolean, and title is never reached.
    // apReason should contain the title as fallback
    expect(row.apReason).toContain('Deploy to production')
  })

  // ── BUG: agent_timeline items with status 'done' show as 'running' ──
  it('BUG: agent_timeline item with status done should show as ok, not running', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [
          { label: 'Compile', detail: 'Build succeeded', status: 'done' },
        ],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // BUG: status 'done' falls through to default 'running'
    expect(row.status).toBe('ok')
  })

  // ── BUG: agent_timeline items with status 'todo' show as 'running' ──
  it('BUG: agent_timeline item with status todo should not show as running', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl2', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [
          { label: 'Future step', status: 'todo' },
        ],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // BUG: status 'todo' falls through to default 'running'
    // It should arguably be 'waiting' or some distinct state, but at minimum
    // it shouldn't be 'running' which implies in-progress work.
    // Since RowItem.status has 'running' | 'ok' | 'fail' | 'waiting',
    // 'waiting' is the best fit for 'todo'.
    expect(row.status).toBe('waiting')
  })

  // ── BUG: null author on agent text block crashes ──
  it('BUG: null author on agent text block should not crash', () => {
    const blocks = [
      { id: 't1', kind: 'text' as const, createdAt: makeTime(1), author: null as unknown as TranscriptBlock['author'], text: 'hello' },
    ] as TranscriptBlock[]
    // BUG: newAgentBlock(block.author, ...) accesses author.name without optional chaining, throws TypeError
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  // ── BUG: null author on structured block (e.g. thinking) crashes ──
  it('BUG: null author on thinking block should not crash', () => {
    const blocks = [
      { id: 'th1', kind: 'thinking' as const, createdAt: makeTime(1), author: null as unknown as TranscriptBlock['author'], content: 'x', isThinking: true },
    ] as TranscriptBlock[]
    // BUG: line 516 accesses block.author.id and block.author.name without optional chaining
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  // ── BUG: user text with null author crashes on block.author.name ──
  it('BUG: user text with null author should not crash on author.name access', () => {
    // role check: block.author?.role ?? 'system' = 'system' (since author is null)
    // So this would NOT enter the user text path, but would enter the agent text path
    // and crash. However, if author had role 'human' but was somehow null (impossible by types),
    // the real concern is: null author defaults to role 'system', then enters agent branches.
    // The test verifies a null-author block of kind 'text' at least doesn't crash outright.
    const blocks = [
      { id: 'u1', kind: 'text' as const, createdAt: makeTime(1), author: null as unknown as TranscriptBlock['author'], text: 'hello' },
    ] as TranscriptBlock[]
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  // ── BUG: tool_result with running tool_call where result has failed status ──
  it('BUG: tool_result with failed status should be reflected after merge', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Bash', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Bash', status: 'failed', summary: 'exit code 1' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // BUG: statusNorm('failed') = 'fail', which is correct. But let's verify the merge preserves it.
    expect(row.status).toBe('fail')
    expect(row.isResult).toBe(true)
  })

  // ── BUG: multiple tool_calls with same toolName get wrong result pairing ──
  it('BUG: tool_result should pair with the correct tool_call when multiple share the same toolName', () => {
    // Two Read calls, then two Read results. The first result should pair with the first call.
    const blocks: TranscriptBlock[] = [
      { id: 'tc_read1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'running', target: '/file1.ts' },
      { id: 'tc_read2', kind: 'tool_call', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'running', target: '/file2.ts' },
      { id: 'tr_read1', kind: 'tool_result', createdAt: makeTime(3), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'content of file1' },
      { id: 'tr_read2', kind: 'tool_result', createdAt: makeTime(4), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'content of file2' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows!
    // BUG: findLastIndex always matches the last tool_call with same toolName.
    // After first merge: [Read(merged, isResult=true, content='content of file1'), Read(running)]
    // After second merge: [Read(running), Read(merged, isResult=true, content='content of file2')]
    // The first Read call never gets its own result — the second result overwrites it.
    // Expected: both Read calls should be resolved with their respective results.
    expect(rows).toHaveLength(2)
    // Both should have isResult: true since each has its own result
    expect(rows[0]!.isResult).toBe(true)
    expect(rows[1]!.isResult).toBe(true)
    // Content should match respective results
    expect(rows[0]!.content).toBe('content of file1')
    expect(rows[1]!.content).toBe('content of file2')
  })

  // ── BUG: statusNorm maps undefined to 'ok' silently ──
  it('BUG: statusNorm should not silently map undefined to ok', () => {
    // tool_result with undefined status should not default to 'ok'
    const blocks: TranscriptBlock[] = [
      {
        id: 'tr1', kind: 'tool_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: 'Read', status: undefined as unknown as TranscriptBlock['status'],
        summary: 'output',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // BUG: undefined status falls through to 'ok' via statusNorm's default branch.
    // An undefined/missing status is ambiguous — 'running' or leaving it undefined
    // would be safer than falsely claiming 'ok'.
    expect(row.status).not.toBe('ok')
  })

  // ── BUG: empty string content in thinking block ──
  it('BUG: thinking block with empty content should produce empty string, not crash', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: '', isThinking: true },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('think')
    expect(row.content).toBe('')
  })

  // ── BUG: thinking block with isThinking false but no content ──
  it('BUG: thinking block with isThinking=false should show ok status with empty content', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: undefined, isThinking: false },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('ok')
    // BUG: content can be '' (empty string from `t.content || ''`)
    // Actually line 159: `content: t.content || ''`, so undefined becomes '' — that's fine.
    expect(row.content).toBe('')
  })

  // ── BUG: context_usage with negative or NaN tokens ──
  it('BUG: context_usage with NaN usagePercent should not produce NaN in ctxPct', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'cu1', kind: 'context_usage', createdAt: makeTime(1), author: makeAuthor('b1'),
        inputTokens: 0, outputTokens: 0, usagePercent: NaN,
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // BUG: c.usagePercent || 0 — NaN is falsy, so 0 is used. This is actually correct.
    // But let's verify: NaN || 0 = 0. Yes, this edge case is handled.
    expect(row.ctxPct).toBe(0)
  })

  // ── BUG: attachment with size === 0 gives '0 KB' instead of omitting ──
  it('BUG: attachment with zero size should omit fileSize, not show "0 KB"', () => {
    const attachmentRef = { id: 'att-1', name: 'empty.txt', size: 0, mime_type: 'text/plain' }
    const blocks: TranscriptBlock[] = [
      {
        id: 'at1', kind: 'attachment', createdAt: makeTime(1), author: makeAuthor('b1'),
        attachmentRef, contentType: 'file',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // size=0 => Math.round(0/1024)=0 => '0 KB' (truthy!), not undefined.
    // fileSize should be undefined for truly empty files to avoid misleading display.
    expect(row.fileSize).toBeUndefined()
  })

  // ── BUG: diff block with patch containing only context lines ──
  it('BUG: diff block patch with only context lines should produce all ctx type lines', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'd1', kind: 'diff', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'No-op diff', files: ['src/x.ts'],
        patch: ' unchanged line 1\n unchanged line 2',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.diffLines).toHaveLength(2)
    expect(row.diffLines![0]!.type).toBe('ctx')
    expect(row.diffLines![1]!.type).toBe('ctx')
  })

  // ── BUG: failure block reason is empty string (falsy) ──
  it('BUG: failure with empty reason and empty title falls to default Chinese text', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'f1', kind: 'failure', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: '', reason: '',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // f.reason || f.title || '运行失败' — reason='' is falsy, title='' is falsy, falls to default
    expect(row.content).toBe('运行失败')
  })

  // ── BUG: run_step_group with missing author in child blocks ──
  it('BUG: run_step_group children with their own author should use parent author for grouping', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'rsg1', kind: 'run_step_group', createdAt: makeTime(1), author: makeAuthor('parent-agent'),
        icon: '>', title: 'Commands', status: 'completed', open: true,
        children: [
          // Child has a different author — should be overridden by parent author
          { id: 'tc1', kind: 'tool_call', author: makeAuthor('different-agent'), toolName: 'Read', status: 'running' } as TranscriptBlock,
        ] as TranscriptBlock[],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const agent = items[0] as AgentTranscriptBlock
    // Child blocks should be grouped under the parent author
    expect(agent.agent).toBe(DEFAULT_AGENT_NAME)
    expect(agent.rows).toHaveLength(1)
  })

  // ── BUG: deploy with only status='failed' should show fail ──
  it('BUG: deploy with status=failed and no extra metadata shows fail status and default meta', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'dp1', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'),
        runId: 'run-fail', status: 'failed',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    expect(row.status).toBe('fail')
    // metaParts: ['failed'], so deployMeta = 'failed' (not 'Deployed')
    expect(row.deployMeta).toBe('failed')
  })

  // ── BUG: deploy with ready status should show ok ──
  it('BUG: deploy with ready status should map to ok', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'dp1', kind: 'deploy', createdAt: makeTime(1), author: makeAuthor('b1'),
        runId: 'run-1', status: 'ready',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // deployStatusNorm maps 'ready' to 'ok'
    expect(row.status).toBe('ok')
  })

  // ── BUG: subagent with undefined summary and title ──
  it('BUG: subagent with empty title and no summary should not crash', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'sa1', kind: 'subagent', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: '', worker: 'w1', status: 'running',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('sub')
    // block.worker = 'w1' (truthy), so name = 'w1', label = 'Agent · w1'
    expect(row.label).toContain('w1')
    // block.summary is undefined, so content = block.title = ''
    expect(row.content).toBe('')
  })

  // ── BUG: file_change with empty path ──
  it('BUG: file_change with empty path should produce empty content and extra', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'fc1', kind: 'file_change', createdAt: makeTime(1), author: makeAuthor('b1'),
        path: '', action: 'modified',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('file')
    expect(row.fileOp).toBe('mod')
    // ''.split('.')=[''] → .pop()='' → .toUpperCase()='' → || '' = ''
    expect(row.content).toBe('')
    expect(row.extra).toBe('')
  })

  // ── BUG: tool_call with undefined toolName crashes on toLowerCase ──
  it('BUG: tool_call with undefined toolName should not crash on toLowerCase', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: undefined as unknown as string, status: 'running',
      },
    ] as TranscriptBlock[]
    // BUG: line 174: t.toolName.toLowerCase() — crashes if toolName is undefined
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  // ── BUG: tool_result with undefined toolName crashes on toLowerCase ──
  it('BUG: tool_result with undefined toolName should not crash on toLowerCase', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tr1', kind: 'tool_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: undefined as unknown as string, status: 'completed', summary: 'ok',
      },
    ] as TranscriptBlock[]
    // BUG: line 187: t.toolName.toLowerCase() — crashes if toolName is undefined
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  // ── BUG: thinking status not updated when isThinking changes mid-stream ──
  it('BUG: thinking block with isThinking=false shows ok while earlier thinking=true showed running', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'Plan', isThinking: true },
      { id: 'th2', kind: 'thinking', createdAt: makeTime(2), author: makeAuthor('b1'), content: 'Refined plan', isThinking: false },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows!
    expect(rows).toHaveLength(2)
    expect(rows[0]!.status).toBe('running')
    expect(rows[1]!.status).toBe('ok')
    // BUG: the first thinking row is still 'running' even though thinking has completed.
    // There is no logic to back-update earlier rows when thinking completes.
    // This is arguably by design (historical accuracy), so we note it here.
  })

  // ── BUG: permission_request without toolName produces empty apReason start ──
  it('BUG: permission_request without toolName or risk should still show reason', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'pr1', kind: 'permission_request', createdAt: makeTime(1), author: makeAuthor('b1'),
        requestId: 'req-1', title: 'Access request', status: 'pending',
        reason: 'Needs to read sensitive data',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // parts = [] → no toolName, no risk (not in PermissionRequestTranscriptBlock directly...
    // wait, risk IS an optional field on PermissionRequestTranscriptBlock)
    // 'reason' in a → true (property exists), so baseReason = a.reason (defined)
    // parts = [undefined, undefined, 'Needs to read sensitive data'] → filtered → ['Needs to read sensitive data']
    // BUG: 'reason' in a is always true, but reason being set here makes it work.
    // However, toolName and risk are both undefined, filtered out, so apReason = 'Needs to read sensitive data'
    expect(row.apReason).toBe('Needs to read sensitive data')
  })

  // ── BUG: permission_result using 'reason in a' check cannot distinguish from permission_request ──
  it('BUG: permission_result without reason should show title in apReason', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'pr2', kind: 'permission_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        requestId: 'req-1', title: 'Allowed write', status: 'completed',
        decision: 'allow', toolName: 'Write',
        // reason not provided
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // BUG: 'reason' in a is true (property exists on interface), a.reason = undefined,
    // baseReason = undefined (not title, because 'reason' in a is true!).
    // parts = ['Write'] only. Title 'Allowed write' is lost.
    expect(row.apReason).toContain('Allowed write')
    expect(row.apReason).toContain('Write')
  })

  // ── BUG: agent_timeline items with undefined detail ──
  it('BUG: agent_timeline item with undefined detail should not append "undefined"', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tl1', kind: 'agent_timeline', createdAt: makeTime(1), author: makeAuthor('b1'),
        items: [
          { label: 'Check', status: 'completed' },
          // detail is undefined
        ],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // BUG: `${ti.label}: ${ti.detail || ''}` — with undefined detail, this is 'Check: '
    // The trailing ': ' is ugly but not a crash. The OR handles undefined.
    expect(row.content).toBe('Check: ')
  })

  // ── BUG: statusNorm with unrecognized status string (e.g. 'aborted') ──
  it('BUG: statusNorm should not silently treat unrecognized status as ok', () => {
    // Using tool_result as a vehicle for statusNorm
    const blocks: TranscriptBlock[] = [
      {
        id: 'tr1', kind: 'tool_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: 'Read', status: 'aborted' as unknown as TranscriptBlock['status'],
        summary: 'was aborted',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // BUG: 'aborted' doesn't match any case in statusNorm, defaults to 'ok'.
    // Unrecognized status should not be silently treated as success.
    expect(row.status).not.toBe('ok')
  })

  // ── BUG: context_usage with contextLimit=0 should omit "limit: 0k" ──
  it('BUG: context_usage with contextLimit=0 should omit limit stat', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'cu1', kind: 'context_usage', createdAt: makeTime(1), author: makeAuthor('b1'),
        inputTokens: 1000, outputTokens: 500, contextLimit: 0,
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // BUG: c.contextLimit is 0, which is falsy, so the ternary produces '',
    // which is filtered out by filter(Boolean). This is correct!
    // But let's verify.
    expect(row.ctxStats).not.toContain('limit: 0k')
  })

  // ── BUG: tool_result content when summary is undefined ──
  it('BUG: tool_result with undefined summary should have undefined content', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tr1', kind: 'tool_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: 'Read', status: 'completed',
        // summary is undefined
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // BUG: content: t.summary — when undefined, content is undefined.
    // RowItem.content is optional (string | undefined), so this is fine.
    expect(row.content).toBeUndefined()
  })

  // ── BUG: artifact with action='modified' (not 'created' or 'deleted') ──
  it('BUG: artifact with action=modified should map to mod fileOp', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'a1', kind: 'artifact', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'report.pdf', action: 'modified',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // a.action === 'deleted'? false → a.action === 'created'? false → 'mod'
    expect(row.fileOp).toBe('mod')
  })

  // ── BUG: run_session with empty tags generates empty string tags ──
  it('BUG: run_session with no optional labels should produce empty sessionTags array', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'rs1', kind: 'run_session', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Minimal session',
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // sessionTags: ['', '', ''] → filter(Boolean) → []
    expect(row.sessionTags).toEqual([])
  })

  // ═══════════════════════════════════════════════════════════════════════
  // EDGE CASE TESTS — requested additions
  // ═══════════════════════════════════════════════════════════════════════

  // ── Missing createdAt ──
  it('handles block with missing createdAt without crash', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', author: makeAuthor('b1'), content: 'no time', isThinking: true },
    ] as TranscriptBlock[]
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const agent = items[0] as AgentTranscriptBlock
    expect(agent.time).toBe('')
  })

  it('handles user text block with missing createdAt without crash', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'u1', kind: 'text', author: makeUser('alice'), text: 'no time' },
    ] as TranscriptBlock[]
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    expect(items[0]!.time).toBe('')
  })

  it('handles agent text block with missing createdAt without crash', () => {
    const blocks: TranscriptBlock[] = [
      { id: 't1', kind: 'text', author: { id: 'a1', name: 'Bot', role: 'agent' as const }, text: 'hello' },
    ] as TranscriptBlock[]
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  it('handles all blocks in a group missing createdAt without crash', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', author: makeAuthor('b1'), content: 'a', isThinking: true },
      { id: 'tc1', kind: 'tool_call', author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
      { id: 'tr1', kind: 'tool_result', author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'ok' },
    ] as TranscriptBlock[]
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    expect((items[0] as AgentTranscriptBlock).rows).toHaveLength(2)
  })

  // ── Unknown block kind ──
  it('returns null for unknown block kind (no crash)', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'unk1', kind: 'imaginary_block_kind' as unknown as TranscriptBlock['kind'], author: makeAuthor('b1') },
    ] as TranscriptBlock[]
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
    const items = blocksToTranscriptItems(blocks)
    // Unknown block kind is skipped, no agent block is created
    expect(items).toHaveLength(0)
  })

  it('returns null for unknown block kind mixed with known blocks', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'real', isThinking: true },
      { id: 'unk1', kind: '__never_defined__' as unknown as TranscriptBlock['kind'], author: makeAuthor('b1') },
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'running' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    expect(items).toHaveLength(1)
    const rows = (items[0] as AgentTranscriptBlock).rows!
    // Only thinking + tool_call; unknown block is silently skipped
    expect(rows).toHaveLength(2)
    expect(rows[0]!.type).toBe('think')
    expect(rows[1]!.type).toBe('tool')
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ALL 4 STATUS VARIANTS FOR EVERY CARD TYPE
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
