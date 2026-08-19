// real_tested=true
/**
 * Unit tests for `mapBlock` — the chatview adapter single-block → RowItem
 * mapper (`adapterMapBlock.ts`).
 *
 * Covers every mapped block kind (thinking, tool_call, tool_result,
 * file_change, artifact, diff, approval/permission_request/permission_result,
 * run_session, subagent/subtask/child_agent, route_decision, context_usage,
 * deploy, attachment, failure, preview), the skip-list kinds that map to
 * `null`, status-normalization branches (statusNorm / deployStatusNorm), and
 * optional-field fallbacks.
 */

import { describe, it, expect } from 'vitest'
import { mapBlock } from './adapterMapBlock'
import { SEP } from './adapterShared'
import type { RowItem } from './types'
import type { TranscriptAuthor, TranscriptBlock } from '../transcript/types'

const author: TranscriptAuthor = { id: 'agent-1', name: 'TestAgent', role: 'agent' }

/** Map a block and assert the mapper produced a row (not `null`). */
const mapToRow = (block: TranscriptBlock): RowItem => {
  const row = mapBlock(block)
  expect(row).not.toBeNull()
  return row as RowItem
}

describe('mapBlock', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // thinking → think row
  // ═══════════════════════════════════════════════════════════════════════
  describe('thinking blocks', () => {
    it('maps an in-flight thinking block to a running think row', () => {
      const row = mapToRow({ id: 'th-1', kind: 'thinking', author, content: 'Analyzing code', isThinking: true })
      expect(row).toEqual({
        id: 'th-1',
        type: 'think',
        label: '',
        status: 'running',
        collapsible: true,
        content: 'Analyzing code',
      })
    })

    it('maps a finished thinking block to an ok think row', () => {
      const row = mapToRow({ id: 'th-2', kind: 'thinking', author, content: 'Done', isThinking: false })
      expect(row.status).toBe('ok')
      expect(row.content).toBe('Done')
    })

    it('treats a missing isThinking flag as finished (ok)', () => {
      const row = mapToRow({ id: 'th-3', kind: 'thinking', author, content: 'x' })
      expect(row.status).toBe('ok')
    })

    it('falls back to empty string content when the block has none', () => {
      const row = mapToRow({ id: 'th-4', kind: 'thinking', author })
      expect(row.content).toBe('')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // tool_call → tool row
  // ═══════════════════════════════════════════════════════════════════════
  describe('tool_call blocks', () => {
    it('maps a running tool call with lowercased toolName and original label', () => {
      const row = mapToRow({ id: 'tc-1', kind: 'tool_call', author, toolName: 'Read', status: 'running' })
      expect(row).toEqual({
        id: 'tc-1',
        type: 'tool',
        label: 'Read',
        status: 'running',
        collapsible: true,
        toolName: 'read',
      })
    })

    it('maps a completed tool call to ok', () => {
      const row = mapToRow({ id: 'tc-2', kind: 'tool_call', author, toolName: 'Grep', status: 'completed' })
      expect(row.status).toBe('ok')
    })

    it('maps a failed tool call to fail', () => {
      const row = mapToRow({ id: 'tc-3', kind: 'tool_call', author, toolName: 'Bash', status: 'failed' })
      expect(row.status).toBe('fail')
    })

    it('maps a pending tool call to running', () => {
      const row = mapToRow({ id: 'tc-4', kind: 'tool_call', author, toolName: 'Write', status: 'pending' })
      expect(row.status).toBe('running')
    })

    it('marks a running tool call with completed evidence refs as ok', () => {
      const row = mapToRow({
        id: 'tc-5', kind: 'tool_call', author, toolName: 'Run', status: 'running',
        evidenceRefs: [{ id: 'ev-1', kind: 'tool', label: 'output', status: 'completed' }],
      })
      expect(row.status).toBe('ok')
    })

    it('keeps fail status even when completed evidence refs are present', () => {
      const row = mapToRow({
        id: 'tc-6', kind: 'tool_call', author, toolName: 'Run', status: 'failed',
        evidenceRefs: [{ id: 'ev-1', kind: 'tool', label: 'output', status: 'completed' }],
      })
      expect(row.status).toBe('fail')
    })

    it('keeps running status when evidence refs are not completed', () => {
      const row = mapToRow({
        id: 'tc-7', kind: 'tool_call', author, toolName: 'Run', status: 'running',
        evidenceRefs: [
          { id: 'ev-1', kind: 'tool', label: 'pending part', status: 'pending' },
          { id: 'ev-2', kind: 'file', label: 'no status' },
        ],
      })
      expect(row.status).toBe('running')
    })

    it('propagates callId as toolCallId', () => {
      const row = mapToRow({ id: 'tc-8', kind: 'tool_call', author, toolName: 'Read', status: 'running', callId: 'call-1' })
      expect(row.toolCallId).toBe('call-1')
    })

    it('omits toolCallId when callId is absent', () => {
      const row = mapToRow({ id: 'tc-9', kind: 'tool_call', author, toolName: 'Read', status: 'running' })
      expect(row).not.toHaveProperty('toolCallId')
    })

    it('prefers summary for content and leaves extra empty when both summary and target exist', () => {
      const row = mapToRow({
        id: 'tc-10', kind: 'tool_call', author, toolName: 'Read', status: 'running',
        summary: 'Reading config', target: '/etc/app.conf',
      })
      expect(row.content).toBe('Reading config')
      expect(row.extra).toBeUndefined()
    })

    it('uses target as both content and extra when there is no summary', () => {
      const row = mapToRow({
        id: 'tc-11', kind: 'tool_call', author, toolName: 'Read', status: 'running',
        target: '/etc/hosts',
      })
      expect(row.content).toBe('/etc/hosts')
      expect(row.extra).toBe('/etc/hosts')
    })

    it('uses summary as content without extra when there is no target', () => {
      const row = mapToRow({
        id: 'tc-12', kind: 'tool_call', author, toolName: 'Think', status: 'running',
        summary: 'Planning next step',
      })
      expect(row.content).toBe('Planning next step')
      expect(row.extra).toBeUndefined()
    })

    it('leaves content and extra undefined when neither summary nor target exist', () => {
      const row = mapToRow({ id: 'tc-13', kind: 'tool_call', author, toolName: 'Noop', status: 'running' })
      expect(row.content).toBeUndefined()
      expect(row.extra).toBeUndefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // tool_result → tool row (isResult)
  // ═══════════════════════════════════════════════════════════════════════
  describe('tool_result blocks', () => {
    it('maps a completed tool result to an ok result row', () => {
      const row = mapToRow({
        id: 'tr-1', kind: 'tool_result', author, toolName: 'Grep',
        status: 'completed', summary: '3 matches', callId: 'call-9',
      })
      expect(row).toEqual({
        id: 'tr-1',
        type: 'tool',
        label: 'Grep',
        status: 'ok',
        collapsible: true,
        toolName: 'grep',
        toolCallId: 'call-9',
        content: '3 matches',
        isResult: true,
      })
    })

    it('maps a pending tool result to running via statusNorm', () => {
      const row = mapToRow({ id: 'tr-2', kind: 'tool_result', author, toolName: 'Read', status: 'pending' })
      expect(row.status).toBe('running')
    })

    it('maps a running tool result to running via statusNorm', () => {
      const row = mapToRow({ id: 'tr-3', kind: 'tool_result', author, toolName: 'Read', status: 'running' })
      expect(row.status).toBe('running')
    })

    it('maps a failed tool result to fail via statusNorm', () => {
      const row = mapToRow({ id: 'tr-4', kind: 'tool_result', author, toolName: 'Read', status: 'failed' })
      expect(row.status).toBe('fail')
    })

    it('leaves content undefined without summary and omits toolCallId without callId', () => {
      const row = mapToRow({ id: 'tr-5', kind: 'tool_result', author, toolName: 'Read', status: 'completed' })
      expect(row.content).toBeUndefined()
      expect(row).not.toHaveProperty('toolCallId')
      expect(row.isResult).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // file_change → file row
  // ═══════════════════════════════════════════════════════════════════════
  describe('file_change blocks', () => {
    it('maps a created file change with patch to a file row with diff lines', () => {
      const row = mapToRow({
        id: 'fc-1', kind: 'file_change', author, path: 'src/app/util.ts', action: 'created',
        patch: '@@ -1,2 +1,2 @@\n-const old = 1\n+const next = 2\n const same = 3',
      })
      expect(row).toEqual({
        id: 'fc-1',
        type: 'file',
        label: '',
        extra: 'src/app/util.ts',
        status: 'ok',
        collapsible: true,
        fileOp: 'cr',
        content: 'TS',
        diffLines: [
          { type: 'ctx', text: '@@ -1,2 +1,2 @@' },
          { type: 'del', text: '-const old = 1' },
          { type: 'add', text: '+const next = 2' },
          { type: 'ctx', text: ' const same = 3' },
        ],
      })
    })

    it('maps a modified file change to fileOp mod', () => {
      const row = mapToRow({ id: 'fc-2', kind: 'file_change', author, path: 'src/main.tsx', action: 'modified' })
      expect(row.fileOp).toBe('mod')
    })

    it('maps a deleted file change to fileOp del', () => {
      const row = mapToRow({ id: 'fc-3', kind: 'file_change', author, path: 'legacy/old.js', action: 'deleted' })
      expect(row.fileOp).toBe('del')
    })

    it('leaves diffLines undefined when the block has no patch', () => {
      const row = mapToRow({ id: 'fc-4', kind: 'file_change', author, path: 'src/main.ts', action: 'modified' })
      expect(row.diffLines).toBeUndefined()
    })

    it('uppercases the whole dot-less path as content when there is no extension', () => {
      const row = mapToRow({ id: 'fc-5', kind: 'file_change', author, path: 'build/Makefile', action: 'modified' })
      expect(row.content).toBe('BUILD/MAKEFILE')
    })

    it('truncates diff lines to the 40-line default for large patches', () => {
      const longPatch = Array.from({ length: 45 }, (_, index) => `+line ${index}`).join('\n')
      const row = mapToRow({ id: 'fc-6', kind: 'file_change', author, path: 'big.txt', action: 'modified', patch: longPatch })
      expect(row.diffLines).toHaveLength(40)
      expect(row.diffLines?.every(line => line.type === 'add')).toBe(true)
      expect(row.diffLines?.[0]?.text).toBe('+line 0')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // artifact → file row
  // ═══════════════════════════════════════════════════════════════════════
  describe('artifact blocks', () => {
    it('joins path, uri, and mimeType into extra with SEP', () => {
      const row = mapToRow({
        id: 'ar-1', kind: 'artifact', author, title: 'Report', path: 'out/report.pdf',
        uri: 'https://hub.example/artifacts/1', mimeType: 'application/pdf', action: 'created',
      })
      expect(row.extra).toBe(['out/report.pdf', 'https://hub.example/artifacts/1', 'application/pdf'].join(SEP))
      expect(row.fileOp).toBe('cr')
      expect(row.content).toBe('PDF')
      expect(row.status).toBe('ok')
    })

    it('maps a deleted artifact to fileOp del', () => {
      const row = mapToRow({ id: 'ar-2', kind: 'artifact', author, title: 'old.zip', action: 'deleted' })
      expect(row.fileOp).toBe('del')
    })

    it('maps a modified artifact to fileOp mod', () => {
      const row = mapToRow({ id: 'ar-3', kind: 'artifact', author, title: 'doc.md', action: 'modified' })
      expect(row.fileOp).toBe('mod')
    })

    it('defaults fileOp to mod when action is absent', () => {
      const row = mapToRow({ id: 'ar-4', kind: 'artifact', author, title: 'doc.md' })
      expect(row.fileOp).toBe('mod')
    })

    it('falls back to title for extra and content when path is missing', () => {
      const row = mapToRow({ id: 'ar-5', kind: 'artifact', author, title: 'chart.png', action: 'modified' })
      expect(row.extra).toBe('chart.png')
      expect(row.content).toBe('PNG')
    })

    it('falls back to artifactKind for content when path and title are empty', () => {
      const row = mapToRow({ id: 'ar-6', kind: 'artifact', author, title: '', artifactKind: 'code' })
      expect(row.content).toBe('code')
      expect(row.extra).toBe('')
    })

    it('falls back to empty content when path, title, and artifactKind are all empty', () => {
      const row = mapToRow({ id: 'ar-7', kind: 'artifact', author, title: '' })
      expect(row.content).toBe('')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // diff → file row
  // ═══════════════════════════════════════════════════════════════════════
  describe('diff blocks', () => {
    it('maps a diff with additions, deletions, and patch to a file row', () => {
      const row = mapToRow({
        id: 'df-1', kind: 'diff', author, title: 'PR #12', files: ['src/util.ts'],
        additions: 3, deletions: 1, patch: '+added',
      })
      expect(row).toEqual({
        id: 'df-1',
        type: 'file',
        label: 'PR #12',
        extra: 'src/util.ts',
        status: 'ok',
        collapsible: true,
        fileOp: 'mod',
        content: 'TS +3 -1',
        diffLines: [{ type: 'add', text: '+added' }],
      })
    })

    it('includes only additions in content when deletions are absent', () => {
      const row = mapToRow({ id: 'df-2', kind: 'diff', author, title: 'T', files: ['a.ts'], additions: 5 })
      expect(row.content).toBe('TS +5')
      expect(row.diffLines).toBeUndefined()
    })

    it('includes only deletions in content when additions are absent', () => {
      const row = mapToRow({ id: 'df-3', kind: 'diff', author, title: 'T', files: ['a.ts'], deletions: 2 })
      expect(row.content).toBe('TS -2')
    })

    it('renders only the extension when no stats are present', () => {
      const row = mapToRow({ id: 'df-4', kind: 'diff', author, title: 'T', files: ['a.ts'] })
      expect(row.content).toBe('TS')
    })

    it('renders explicit zero additions/deletions (undefined-check, not falsy-check)', () => {
      const row = mapToRow({ id: 'df-5', kind: 'diff', author, title: 'T', files: ['a.ts'], additions: 0, deletions: 0 })
      expect(row.content).toBe('TS +0 -0')
    })

    it('handles an empty files array with empty extra', () => {
      const row = mapToRow({ id: 'df-6', kind: 'diff', author, title: 'T', files: [], additions: 4 })
      expect(row.extra).toBe('')
      expect(row.content).toBe('+4')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // approval / permission_request / permission_result → approval row
  // ═══════════════════════════════════════════════════════════════════════
  describe('approval-family blocks', () => {
    it('maps a pending approval with toolName, risk, and reason', () => {
      const row = mapToRow({
        id: 'ap-1', kind: 'approval', author, title: 'Run command', status: 'pending',
        toolName: 'Bash', risk: 'high', reason: 'Needs shell access',
      })
      expect(row).toEqual({
        id: 'ap-1',
        type: 'approval',
        label: 'Run command',
        status: 'running',
        collapsible: true,
        standalone: true,
        apReason: ['Bash', 'high', 'Needs shell access'].join(SEP),
        riskLevel: 'high',
      })
    })

    it('falls back to the title as apReason when reason is absent', () => {
      const row = mapToRow({ id: 'ap-2', kind: 'approval', author, title: 'Confirm change', status: 'completed' })
      expect(row.apReason).toBe('Confirm change')
      expect(row.riskLevel).toBeUndefined()
      expect(row.status).toBe('ok')
    })

    it('prefers reason over title in apReason when both exist', () => {
      const row = mapToRow({
        id: 'ap-3', kind: 'approval', author, title: 'Confirm change', status: 'completed',
        reason: 'Writes outside workspace',
      })
      expect(row.apReason).toBe('Writes outside workspace')
    })

    it('maps a failed approval to fail', () => {
      const row = mapToRow({ id: 'ap-4', kind: 'approval', author, title: 'Denied', status: 'failed' })
      expect(row.status).toBe('fail')
    })

    it('maps a running approval to running', () => {
      const row = mapToRow({ id: 'ap-5', kind: 'approval', author, title: 'Waiting', status: 'running' })
      expect(row.status).toBe('running')
    })

    it('maps a permission_request to waiting regardless of its status field', () => {
      const row = mapToRow({
        id: 'pr-1', kind: 'permission_request', author, requestId: 'req-1',
        title: 'Allow write', status: 'pending', toolName: 'Write', risk: 'critical', reason: 'Writes file',
      })
      expect(row.status).toBe('waiting')
      expect(row.riskLevel).toBe('critical')
      expect(row.apReason).toBe(['Write', 'critical', 'Writes file'].join(SEP))
      expect(row.label).toBe('Allow write')
    })

    it('maps a completed permission_result to ok with reason in apReason', () => {
      const row = mapToRow({
        id: 'pr-2', kind: 'permission_result', author, requestId: 'req-1',
        title: 'Allow write', status: 'completed', decision: 'allow', reason: 'User approved',
      })
      expect(row.status).toBe('ok')
      expect(row.apReason).toBe('User approved')
      expect(row.riskLevel).toBeUndefined()
    })

    it('maps a failed permission_result to fail', () => {
      const row = mapToRow({
        id: 'pr-3', kind: 'permission_result', author, requestId: 'req-2',
        title: 'Allow write', status: 'failed', decision: 'deny',
      })
      expect(row.status).toBe('fail')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // run_session → session row
  // ═══════════════════════════════════════════════════════════════════════
  describe('run_session blocks', () => {
    it('maps a running session with all tags', () => {
      const row = mapToRow({
        id: 'rs-1', kind: 'run_session', author, title: 'Build run', status: 'running',
        agentLabel: 'Builder', runtimeLabel: 'Edge', meta: 'task-42',
      })
      expect(row).toEqual({
        id: 'rs-1',
        type: 'session',
        label: 'Build run',
        status: 'running',
        collapsible: true,
        standalone: true,
        sessionTags: ['Agent: Builder', 'Runtime: Edge', 'task-42'],
      })
    })

    it('defaults a missing status to completed (ok)', () => {
      const row = mapToRow({ id: 'rs-2', kind: 'run_session', author, title: 'Done run' })
      expect(row.status).toBe('ok')
    })

    it('maps a failed session to fail', () => {
      const row = mapToRow({ id: 'rs-3', kind: 'run_session', author, title: 'Bad run', status: 'failed' })
      expect(row.status).toBe('fail')
    })

    it('produces empty sessionTags when labels and meta are absent', () => {
      const row = mapToRow({ id: 'rs-4', kind: 'run_session', author, title: 'Bare run', status: 'completed' })
      expect(row.sessionTags).toEqual([])
    })

    it('includes only the present tags in order', () => {
      const row = mapToRow({
        id: 'rs-5', kind: 'run_session', author, title: 'Partial run', status: 'completed',
        agentLabel: 'Builder', meta: 'edge-run-7',
      })
      expect(row.sessionTags).toEqual(['Agent: Builder', 'edge-run-7'])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // subagent / subtask / child_agent → sub row
  // ═══════════════════════════════════════════════════════════════════════
  describe('subagent-family blocks', () => {
    it('maps a subagent using its worker name in the label', () => {
      const row = mapToRow({
        id: 'sa-1', kind: 'subagent', author, title: 'Lint pass', worker: 'linter-1',
        status: 'running', summary: 'Linting files',
      })
      expect(row).toEqual({
        id: 'sa-1',
        type: 'sub',
        label: `Agent${SEP}linter-1`,
        status: 'running',
        collapsible: true,
        content: 'Linting files',
      })
    })

    it('falls back to the title as content when the subagent has no summary', () => {
      const row = mapToRow({ id: 'sa-2', kind: 'subagent', author, title: 'Lint pass', worker: 'linter-1', status: 'completed' })
      expect(row.content).toBe('Lint pass')
      expect(row.status).toBe('ok')
    })

    it('maps a worker-less subtask using its title as the name', () => {
      const row = mapToRow({ id: 'st-1', kind: 'subtask', author, title: 'Write tests', status: 'completed' })
      expect(row.label).toBe(`Agent${SEP}Write tests`)
      expect(row.status).toBe('ok')
    })

    it('falls back to the title for a subtask with an empty worker', () => {
      const row = mapToRow({ id: 'st-2', kind: 'subtask', author, title: 'Write tests', worker: '', status: 'running' })
      expect(row.label).toBe(`Agent${SEP}Write tests`)
    })

    it('maps a child_agent using its agent name', () => {
      const row = mapToRow({
        id: 'ca-1', kind: 'child_agent', author, title: 'Research task', agent: 'scout',
        status: 'completed', summary: 'Found references',
      })
      expect(row.label).toBe(`Agent${SEP}scout`)
      expect(row.content).toBe('Found references')
      expect(row.status).toBe('ok')
    })

    it('falls back to the plain title label for a child_agent with an empty agent name', () => {
      const row = mapToRow({ id: 'ca-2', kind: 'child_agent', author, title: 'Fallback title', agent: '', status: 'running' })
      expect(row.label).toBe('Fallback title')
      expect(row.content).toBe('Fallback title')
    })

    it('maps a failed subagent to fail', () => {
      const row = mapToRow({ id: 'sa-3', kind: 'subagent', author, title: 'T', worker: 'w', status: 'failed' })
      expect(row.status).toBe('fail')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // route_decision → route row
  // ═══════════════════════════════════════════════════════════════════════
  describe('route_decision blocks', () => {
    it('maps a route decision to a standalone ok route row', () => {
      const row = mapToRow({
        id: 'rd-1', kind: 'route_decision', author, action: 'dispatch',
        summary: 'Route to builder', targetAgent: 'builder',
      })
      expect(row).toEqual({
        id: 'rd-1',
        type: 'route',
        label: 'dispatch',
        status: 'ok',
        collapsible: false,
        standalone: true,
        content: 'Route to builder',
      })
    })

    it('leaves content undefined when the decision has no summary', () => {
      const row = mapToRow({ id: 'rd-2', kind: 'route_decision', author, action: 'finish' })
      expect(row.content).toBeUndefined()
      expect(row.label).toBe('finish')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // context_usage → ctx row
  // ═══════════════════════════════════════════════════════════════════════
  describe('context_usage blocks', () => {
    it('maps a fully-populated context usage block', () => {
      const row = mapToRow({
        id: 'cu-1', kind: 'context_usage', author,
        inputTokens: 12345, outputTokens: 987, usagePercent: 37,
        contextLimit: 128000, cachePercent: 42, cost: '$0.05', modelLabel: 'Claude Sonnet',
      })
      expect(row).toEqual({
        id: 'cu-1',
        type: 'ctx',
        label: '',
        status: 'ok',
        collapsible: true,
        standalone: true,
        ctxPct: 37,
        ctxStats: ['in: 12.3k', 'out: 1.0k', 'limit: 128k', 'cache: 42%', '$0.05', 'Claude Sonnet'],
      })
    })

    it('omits absent optional stats and defaults ctxPct to 0', () => {
      const row = mapToRow({ id: 'cu-2', kind: 'context_usage', author, inputTokens: 0, outputTokens: 2500 })
      expect(row.ctxPct).toBe(0)
      expect(row.ctxStats).toEqual(['in: 0.0k', 'out: 2.5k'])
    })

    it('passes through usagePercent when present', () => {
      const row = mapToRow({ id: 'cu-3', kind: 'context_usage', author, inputTokens: 100, outputTokens: 200, usagePercent: 88 })
      expect(row.ctxPct).toBe(88)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // deploy → deploy row
  // ═══════════════════════════════════════════════════════════════════════
  describe('deploy blocks', () => {
    it('maps a deploying block with full meta to a running deploy row', () => {
      const row = mapToRow({
        id: 'dp-1', kind: 'deploy', author, runId: 'run-1', status: 'deploying',
        deployType: 'static', path: 'dist', artifactId: 'art-9', url: 'https://app.example.com',
      })
      expect(row).toEqual({
        id: 'dp-1',
        type: 'deploy',
        label: '',
        status: 'running',
        collapsible: true,
        standalone: true,
        url: 'https://app.example.com',
        deployMeta: ['deploying', 'static', 'dist', 'art-9'].join(SEP),
      })
    })

    it('falls back to "Deployed" meta and ok status for a bare deploy block', () => {
      const row = mapToRow({ id: 'dp-2', kind: 'deploy', author, runId: 'run-2' })
      expect(row.status).toBe('ok')
      expect(row.deployMeta).toBe('Deployed')
      expect(row.url).toBeUndefined()
    })

    it('maps a pending deploy to running', () => {
      const row = mapToRow({ id: 'dp-3', kind: 'deploy', author, runId: 'run-3', status: 'pending' })
      expect(row.status).toBe('running')
    })

    it('maps a ready deploy to ok', () => {
      const row = mapToRow({ id: 'dp-4', kind: 'deploy', author, runId: 'run-4', status: 'ready' })
      expect(row.status).toBe('ok')
    })

    it('maps a deployed deploy to ok', () => {
      const row = mapToRow({ id: 'dp-5', kind: 'deploy', author, runId: 'run-5', status: 'deployed' })
      expect(row.status).toBe('ok')
    })

    it('maps a failed deploy to fail', () => {
      const row = mapToRow({ id: 'dp-6', kind: 'deploy', author, runId: 'run-6', status: 'failed' })
      expect(row.status).toBe('fail')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // attachment → attachment row
  // ═══════════════════════════════════════════════════════════════════════
  describe('attachment blocks', () => {
    it('maps an image attachment with a KB file size', () => {
      const row = mapToRow({
        id: 'at-1', kind: 'attachment', author, contentType: 'image',
        attachmentRef: { id: 'att-1', name: 'screenshot.png', size: 2048, mime_type: 'image/png' },
      })
      expect(row).toEqual({
        id: 'at-1',
        type: 'attachment',
        label: 'screenshot.png',
        extra: 'image',
        status: 'ok',
        collapsible: false,
        standalone: true,
        fileName: 'screenshot.png',
        fileSize: '2 KB',
      })
    })

    it('rounds the KB size to the nearest integer', () => {
      const row = mapToRow({
        id: 'at-2', kind: 'attachment', author, contentType: 'file',
        attachmentRef: { id: 'att-2', name: 'log.txt', size: 5000, mime_type: 'text/plain' },
      })
      expect(row.fileSize).toBe('5 KB')
      expect(row.extra).toBe('file')
    })

    it('leaves fileSize undefined for a zero-byte attachment', () => {
      const row = mapToRow({
        id: 'at-3', kind: 'attachment', author, contentType: 'file',
        attachmentRef: { id: 'att-3', name: 'empty.bin', size: 0, mime_type: 'application/octet-stream' },
      })
      expect(row.fileSize).toBeUndefined()
      expect(row.fileName).toBe('empty.bin')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // failure → think row (fail)
  // ═══════════════════════════════════════════════════════════════════════
  describe('failure blocks', () => {
    it('maps a failure with reason to a failing think row', () => {
      const row = mapToRow({ id: 'fa-1', kind: 'failure', author, title: 'Run failed', reason: 'Out of memory' })
      expect(row).toEqual({
        id: 'fa-1',
        type: 'think',
        label: '',
        status: 'fail',
        collapsible: true,
        content: 'Out of memory',
      })
    })

    it('falls back to the title when no reason is present', () => {
      const row = mapToRow({ id: 'fa-2', kind: 'failure', author, title: 'Run failed' })
      expect(row.content).toBe('Run failed')
    })

    it('falls back to the generic failure copy when reason and title are empty', () => {
      const row = mapToRow({ id: 'fa-3', kind: 'failure', author, title: '' })
      expect(row.content).toBe('运行失败')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // preview → preview row
  // ═══════════════════════════════════════════════════════════════════════
  describe('preview blocks', () => {
    it('extracts the domain and derives the title from the preview URL', () => {
      const row = mapToRow({
        id: 'pv-1', kind: 'preview', author, previewId: 'prev-1', status: 'completed',
        url: 'https://www.github.com/agenthub/core',
      })
      expect(row).toEqual({
        id: 'pv-1',
        type: 'preview',
        label: '',
        status: 'ok',
        collapsible: false,
        standalone: true,
        url: 'https://www.github.com/agenthub/core',
        previewDomain: 'github.com',
        previewTitle: 'core',
      })
    })

    it('derives a readable title from hyphen/underscore path segments without extension', () => {
      const row = mapToRow({
        id: 'pv-2', kind: 'preview', author, previewId: 'prev-2', status: 'completed',
        url: 'https://example.com/docs/setup-guide_v2.md',
      })
      expect(row.previewTitle).toBe('setup guide v2')
      expect(row.previewDomain).toBe('example.com')
    })

    it('falls back to the domain as title for root URLs', () => {
      const row = mapToRow({
        id: 'pv-3', kind: 'preview', author, previewId: 'prev-3', status: 'completed',
        url: 'https://example.com/',
      })
      expect(row.previewTitle).toBe('example.com')
    })

    it('uses the previewId as title and an empty domain when there is no URL', () => {
      const row = mapToRow({ id: 'pv-4', kind: 'preview', author, previewId: 'prev-4', status: 'completed' })
      expect(row.previewDomain).toBe('')
      expect(row.previewTitle).toBe('prev-4')
      expect(row.url).toBeUndefined()
    })

    it('normalizes the preview status via statusNorm', () => {
      const row = mapToRow({ id: 'pv-5', kind: 'preview', author, previewId: 'prev-5', status: 'running', url: 'https://example.com/app' })
      expect(row.status).toBe('running')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // skipped kinds → null
  // ═══════════════════════════════════════════════════════════════════════
  describe('skipped block kinds', () => {
    const skippedBlocks: { name: string; block: TranscriptBlock }[] = [
      { name: 'text', block: { id: 'sk-1', kind: 'text', author, text: 'hello' } },
      { name: 'result', block: { id: 'sk-2', kind: 'result', author, success: true } },
      { name: 'finished', block: { id: 'sk-3', kind: 'finished', author, title: 'Done' } },
      { name: 'replay_gap', block: { id: 'sk-4', kind: 'replay_gap', author, replayedCount: 3 } },
      { name: 'agent_timeline', block: { id: 'sk-5', kind: 'agent_timeline', author, items: [] } },
      {
        name: 'run_step_group',
        block: { id: 'sk-6', kind: 'run_step_group', author, icon: 'run', title: 'Steps', status: 'completed', children: [] },
      },
      { name: 'compact_boundary', block: { id: 'sk-7', kind: 'compact_boundary', author } },
    ]

    it.each(skippedBlocks)('returns null for $name blocks', ({ block }) => {
      expect(mapBlock(block)).toBeNull()
    })
  })
})
