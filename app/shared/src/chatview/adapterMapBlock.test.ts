// real_tested=true
import { describe, it, expect } from 'vitest'

import { mapBlock } from './adapterMapBlock'
import { SEP } from './adapterShared'
import type { RowItem } from './types'
import type { TranscriptBlock } from '../transcript/types'
import { makeAuthor } from './adapter-test-helpers'

/**
 * Assert that `mapBlock` produces a row and return it typed for further checks.
 * Using a dedicated helper keeps every test focused on the mapping semantics.
 */
function mapRow(block: TranscriptBlock): RowItem {
  const row = mapBlock(block)
  expect(row).not.toBeNull()
  return row as RowItem
}

describe('mapBlock — thinking blocks', () => {
  it('maps an in-progress thinking block to a running think row', () => {
    const row = mapRow({
      id: 'th1', kind: 'thinking', author: makeAuthor('a1'), content: 'Plan the fix', isThinking: true,
    })
    expect(row).toEqual({
      id: 'th1', type: 'think', label: '', status: 'running', collapsible: true, content: 'Plan the fix',
    })
  })

  it('maps a finished thinking block to an ok think row', () => {
    const row = mapRow({
      id: 'th2', kind: 'thinking', author: makeAuthor('a1'), content: 'Done', isThinking: false,
    })
    expect(row.status).toBe('ok')
    expect(row.type).toBe('think')
  })

  it('treats a missing isThinking flag as finished (ok)', () => {
    const row = mapRow({ id: 'th3', kind: 'thinking', author: makeAuthor('a1'), content: 'Done' })
    expect(row.status).toBe('ok')
  })

  it('falls back to empty content when content is missing', () => {
    const row = mapRow({ id: 'th4', kind: 'thinking', author: makeAuthor('a1'), isThinking: true })
    expect(row.content).toBe('')
  })
})

describe('mapBlock — tool_call blocks', () => {
  it('maps a running tool call to a running tool row with lowercased toolName', () => {
    const row = mapRow({
      id: 'tc1', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'running',
    })
    expect(row).toEqual({
      id: 'tc1', type: 'tool', label: 'Read', status: 'running', collapsible: true,
      toolName: 'read', content: undefined,
    })
  })

  it('maps a completed tool call to ok', () => {
    const row = mapRow({
      id: 'tc2', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'completed',
    })
    expect(row.status).toBe('ok')
  })

  it('maps a failed tool call to fail', () => {
    const row = mapRow({
      id: 'tc3', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'failed',
    })
    expect(row.status).toBe('fail')
  })

  it('treats a running tool call with completed evidenceRefs as ok', () => {
    const row = mapRow({
      id: 'tc4', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'running',
      evidenceRefs: [{ id: 'er1', kind: 'tool', label: 'Read', status: 'completed' }],
    })
    expect(row.status).toBe('ok')
  })

  it('keeps fail status even when evidenceRefs show completion', () => {
    const row = mapRow({
      id: 'tc5', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'failed',
      evidenceRefs: [{ id: 'er1', kind: 'tool', label: 'Read', status: 'completed' }],
    })
    expect(row.status).toBe('fail')
  })

  it('ignores non-completed evidenceRefs when deriving status', () => {
    const row = mapRow({
      id: 'tc6', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'running',
      evidenceRefs: [
        { id: 'er1', kind: 'tool', label: 'Read', status: 'running' },
        { id: 'er2', kind: 'tool', label: 'Read', status: 'failed' },
      ],
    })
    expect(row.status).toBe('running')
  })

  it('falls back to unknown toolName when toolName is missing', () => {
    const row = mapRow({
      id: 'tc7', kind: 'tool_call', author: makeAuthor('a1'),
      toolName: undefined as unknown as string, status: 'running',
    })
    expect(row.toolName).toBe('unknown')
    expect(row.label).toBe('unknown')
  })

  it('carries the callId as toolCallId when present', () => {
    const row = mapRow({
      id: 'tc8', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'running',
      callId: 'call-42',
    })
    expect(row.toolCallId).toBe('call-42')
  })

  it('omits toolCallId when callId is absent', () => {
    const row = mapRow({
      id: 'tc9', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'running',
    })
    expect(row.toolCallId).toBeUndefined()
  })

  it('uses summary as content and drops the extra target when summary exists', () => {
    const row = mapRow({
      id: 'tc10', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'running',
      target: 'src/a.ts', summary: 'Read src/a.ts',
    })
    expect(row.content).toBe('Read src/a.ts')
    expect(row.extra).toBeUndefined()
  })

  it('falls back to target for both content and extra when summary is absent', () => {
    const row = mapRow({
      id: 'tc11', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'running',
      target: 'src/a.ts',
    })
    expect(row.content).toBe('src/a.ts')
    expect(row.extra).toBe('src/a.ts')
  })

  it('falls back to target when summary is an empty string', () => {
    const row = mapRow({
      id: 'tc12', kind: 'tool_call', author: makeAuthor('a1'), toolName: 'Read', status: 'running',
      target: 'src/a.ts', summary: '',
    })
    expect(row.content).toBe('src/a.ts')
    expect(row.extra).toBe('src/a.ts')
  })
})

describe('mapBlock — tool_result blocks', () => {
  it('maps a completed tool result to an ok result tool row', () => {
    const row = mapRow({
      id: 'tr1', kind: 'tool_result', author: makeAuthor('a1'), toolName: 'Read', status: 'completed',
      summary: 'file contents',
    })
    expect(row).toEqual({
      id: 'tr1', type: 'tool', label: 'Read', status: 'ok', collapsible: true,
      toolName: 'read', content: 'file contents', isResult: true,
    })
  })

  it('maps a failed tool result to fail', () => {
    const row = mapRow({
      id: 'tr2', kind: 'tool_result', author: makeAuthor('a1'), toolName: 'Bash', status: 'failed',
      summary: 'exit 1',
    })
    expect(row.status).toBe('fail')
  })

  it('maps a pending tool result to running', () => {
    const row = mapRow({
      id: 'tr3', kind: 'tool_result', author: makeAuthor('a1'), toolName: 'Bash', status: 'pending',
    })
    expect(row.status).toBe('running')
  })

  it('falls back to unknown toolName when toolName is missing', () => {
    const row = mapRow({
      id: 'tr4', kind: 'tool_result', author: makeAuthor('a1'),
      toolName: undefined as unknown as string, status: 'completed', summary: 'ok',
    })
    expect(row.toolName).toBe('unknown')
    expect(row.label).toBe('unknown')
  })

  it('carries the callId as toolCallId when present', () => {
    const row = mapRow({
      id: 'tr5', kind: 'tool_result', author: makeAuthor('a1'), toolName: 'Read', status: 'completed',
      callId: 'call-7',
    })
    expect(row.toolCallId).toBe('call-7')
  })

  it('leaves content undefined when summary is absent', () => {
    const row = mapRow({
      id: 'tr6', kind: 'tool_result', author: makeAuthor('a1'), toolName: 'Read', status: 'completed',
    })
    expect(row.content).toBeUndefined()
  })
})

describe('mapBlock — file_change blocks', () => {
  it('maps a created file with extension-derived content', () => {
    const row = mapRow({
      id: 'fc1', kind: 'file_change', author: makeAuthor('a1'), path: 'src/new.ts', action: 'created',
    })
    expect(row).toEqual({
      id: 'fc1', type: 'file', label: '', extra: 'src/new.ts', status: 'ok', collapsible: true,
      fileOp: 'cr', content: 'TS', diffLines: undefined,
    })
  })

  it('maps a modified file to the mod fileOp', () => {
    const row = mapRow({
      id: 'fc2', kind: 'file_change', author: makeAuthor('a1'), path: 'src/old.ts', action: 'modified',
    })
    expect(row.fileOp).toBe('mod')
    expect(row.content).toBe('TS')
  })

  it('maps a deleted file to the del fileOp', () => {
    const row = mapRow({
      id: 'fc3', kind: 'file_change', author: makeAuthor('a1'), path: 'src/gone.ts', action: 'deleted',
    })
    expect(row.fileOp).toBe('del')
  })

  it('converts a patch into typed diff lines', () => {
    const row = mapRow({
      id: 'fc4', kind: 'file_change', author: makeAuthor('a1'), path: 'src/a.ts', action: 'modified',
      patch: '@@ -1 +1 @@\n-old\n+new\n same',
    })
    expect(row.diffLines).toEqual([
      { type: 'ctx', text: '@@ -1 +1 @@' },
      { type: 'del', text: '-old' },
      { type: 'add', text: '+new' },
      { type: 'ctx', text: ' same' },
    ])
  })

  it('omits diffLines when there is no patch', () => {
    const row = mapRow({
      id: 'fc5', kind: 'file_change', author: makeAuthor('a1'), path: 'src/a.ts', action: 'modified',
    })
    expect(row.diffLines).toBeUndefined()
  })

  it('uppercases the whole name for an extensionless path', () => {
    const row = mapRow({
      id: 'fc6', kind: 'file_change', author: makeAuthor('a1'), path: 'README', action: 'modified',
    })
    expect(row.content).toBe('README')
  })

  it('produces empty content for a missing path', () => {
    const row = mapRow({
      id: 'fc7', kind: 'file_change', author: makeAuthor('a1'),
      path: undefined as unknown as string, action: 'modified',
    })
    expect(row.content).toBe('')
    expect(row.extra).toBeUndefined()
  })
})

describe('mapBlock — artifact blocks', () => {
  it('joins path, uri and mimeType into extra with the display separator', () => {
    const row = mapRow({
      id: 'a1', kind: 'artifact', author: makeAuthor('a1'), title: 'Report', path: 'out/report.pdf',
      uri: 'https://example.com/report.pdf', mimeType: 'application/pdf', action: 'created',
    })
    expect(row).toEqual({
      id: 'a1', type: 'file', label: '',
      extra: `out/report.pdf${SEP}https://example.com/report.pdf${SEP}application/pdf`,
      status: 'ok', collapsible: true, fileOp: 'cr', content: 'PDF',
    })
  })

  it('maps a deleted artifact to the del fileOp', () => {
    const row = mapRow({
      id: 'a2', kind: 'artifact', author: makeAuthor('a1'), title: 'x.pdf', action: 'deleted',
    })
    expect(row.fileOp).toBe('del')
  })

  it('maps a modified artifact to the mod fileOp', () => {
    const row = mapRow({
      id: 'a3', kind: 'artifact', author: makeAuthor('a1'), title: 'x.pdf', action: 'modified',
    })
    expect(row.fileOp).toBe('mod')
  })

  it('falls back to the title for extra and content when path is missing', () => {
    const row = mapRow({
      id: 'a4', kind: 'artifact', author: makeAuthor('a1'), title: 'design.png', action: 'created',
    })
    expect(row.extra).toBe('design.png')
    expect(row.content).toBe('PNG')
  })

  it('filters absent uri and mimeType out of extra', () => {
    const row = mapRow({
      id: 'a5', kind: 'artifact', author: makeAuthor('a1'), title: 'notes.md', action: 'created',
    })
    expect(row.extra).toBe('notes.md')
  })

  it('falls back to artifactKind for content when the title is empty', () => {
    const row = mapRow({
      id: 'a6', kind: 'artifact', author: makeAuthor('a1'), title: '', artifactKind: 'pdf', action: 'created',
    })
    expect(row.content).toBe('pdf')
  })

  it('produces empty content when there is no name or artifactKind', () => {
    const row = mapRow({
      id: 'a7', kind: 'artifact', author: makeAuthor('a1'), title: '', action: 'created',
    })
    expect(row.content).toBe('')
    expect(row.extra).toBe('')
  })
})

describe('mapBlock — diff blocks', () => {
  it('maps a diff with stats derived from files and counts', () => {
    const row = mapRow({
      id: 'd1', kind: 'diff', author: makeAuthor('a1'), title: 'PR #1',
      files: ['src/x.ts'], additions: 12, deletions: 3,
    })
    expect(row).toEqual({
      id: 'd1', type: 'file', label: 'PR #1', extra: 'src/x.ts', status: 'ok', collapsible: true,
      fileOp: 'mod', content: 'TS +12 -3',
    })
  })

  it('omits addition and deletion stats when they are undefined', () => {
    const row = mapRow({
      id: 'd2', kind: 'diff', author: makeAuthor('a1'), title: 'PR #2', files: ['src/y.ts'],
    })
    expect(row.content).toBe('TS')
  })

  it('falls back to empty extra and content for a missing files array entry', () => {
    const row = mapRow({
      id: 'd3', kind: 'diff', author: makeAuthor('a1'), title: 'PR #3', files: [] as string[],
    })
    expect(row.extra).toBe('')
    expect(row.content).toBe('')
  })

  it('uppercases an extensionless first file name', () => {
    const row = mapRow({
      id: 'd4', kind: 'diff', author: makeAuthor('a1'), title: 'PR #4', files: ['Makefile'],
    })
    expect(row.content).toBe('Makefile'.toUpperCase())
  })

  it('converts a patch into typed diff lines', () => {
    const row = mapRow({
      id: 'd5', kind: 'diff', author: makeAuthor('a1'), title: 'PR #5', files: ['src/x.ts'],
      patch: '-old\n+new',
    })
    expect(row.diffLines).toEqual([
      { type: 'del', text: '-old' },
      { type: 'add', text: '+new' },
    ])
  })
})

describe('mapBlock — approval blocks', () => {
  it('joins toolName, risk and reason into apReason and carries the risk level', () => {
    const row = mapRow({
      id: 'ap1', kind: 'approval', author: makeAuthor('a1'), title: 'Run command',
      status: 'pending', toolName: 'Bash', risk: 'high', reason: 'Deletes files',
    })
    expect(row).toEqual({
      id: 'ap1', type: 'approval', label: 'Run command', status: 'running',
      collapsible: true, standalone: true,
      apReason: `Bash${SEP}high${SEP}Deletes files`, riskLevel: 'high',
    })
  })

  it('maps a completed approval to ok', () => {
    const row = mapRow({
      id: 'ap2', kind: 'approval', author: makeAuthor('a1'), title: 'Confirm', status: 'completed',
    })
    expect(row.status).toBe('ok')
  })

  it('maps a failed approval to fail', () => {
    const row = mapRow({
      id: 'ap3', kind: 'approval', author: makeAuthor('a1'), title: 'Confirm', status: 'failed',
    })
    expect(row.status).toBe('fail')
  })

  it('falls back to the title in apReason when reason is absent', () => {
    const row = mapRow({
      id: 'ap4', kind: 'approval', author: makeAuthor('a1'), title: 'Deploy to production', status: 'pending',
    })
    expect(row.apReason).toBe('Deploy to production')
    expect(row.riskLevel).toBeUndefined()
  })

  it('omits the risk part when risk is absent', () => {
    const row = mapRow({
      id: 'ap5', kind: 'approval', author: makeAuthor('a1'), title: 'Confirm',
      status: 'pending', toolName: 'Write', reason: 'Needs approval',
    })
    expect(row.apReason).toBe(`Write${SEP}Needs approval`)
    expect(row.riskLevel).toBeUndefined()
  })
})

describe('mapBlock — permission_request blocks', () => {
  it('always maps to waiting regardless of the pending status field', () => {
    const row = mapRow({
      id: 'pr1', kind: 'permission_request', author: makeAuthor('a1'),
      requestId: 'req-1', title: 'Allow write', status: 'pending',
    })
    expect(row.type).toBe('approval')
    expect(row.status).toBe('waiting')
    expect(row.standalone).toBe(true)
    expect(row.label).toBe('Allow write')
  })

  it('joins toolName, risk and reason into apReason', () => {
    const row = mapRow({
      id: 'pr2', kind: 'permission_request', author: makeAuthor('a1'),
      requestId: 'req-2', title: 'Allow write', status: 'pending',
      toolName: 'Write', risk: 'medium', reason: 'Sensitive file',
    })
    expect(row.apReason).toBe(`Write${SEP}medium${SEP}Sensitive file`)
    expect(row.riskLevel).toBe('medium')
  })

  it('falls back to the title in apReason when toolName, risk and reason are absent', () => {
    const row = mapRow({
      id: 'pr3', kind: 'permission_request', author: makeAuthor('a1'),
      requestId: 'req-3', title: 'Access request', status: 'pending',
    })
    expect(row.apReason).toBe('Access request')
  })

  it('#1819 propagates createdAt to waitingSince so the waiting card can show requested time', () => {
    const row = mapRow({
      id: 'pr4', kind: 'permission_request', author: makeAuthor('a1'),
      requestId: 'req-4', title: 'Allow write', status: 'pending',
      createdAt: '2026-08-23T08:30:00.000Z',
    })
    expect(row.waitingSince).toBe('2026-08-23T08:30:00.000Z')
  })

  it('#1819 omits waitingSince when the block carries no createdAt', () => {
    const row = mapRow({
      id: 'pr5', kind: 'permission_request', author: makeAuthor('a1'),
      requestId: 'req-5', title: 'Allow write', status: 'pending',
    })
    expect(row.waitingSince).toBeUndefined()
  })

  it('#1819 never surfaces waitingSince on decided approval rows', () => {
    const row = mapRow({
      id: 'pr6', kind: 'permission_result', author: makeAuthor('a1'),
      requestId: 'req-6', title: 'Allowed', status: 'completed', decision: 'allow',
      createdAt: '2026-08-23T08:30:00.000Z',
    })
    expect(row.status).toBe('ok')
    expect(row.waitingSince).toBeUndefined()
  })
})

describe('mapBlock — permission_result blocks', () => {
  it('maps a completed permission result to ok', () => {
    const row = mapRow({
      id: 'ps1', kind: 'permission_result', author: makeAuthor('a1'),
      requestId: 'req-1', title: 'Allowed', status: 'completed', decision: 'allow',
    })
    expect(row.type).toBe('approval')
    expect(row.status).toBe('ok')
    expect(row.label).toBe('Allowed')
    expect(row.standalone).toBe(true)
  })

  it('maps a failed permission result to fail', () => {
    const row = mapRow({
      id: 'ps2', kind: 'permission_result', author: makeAuthor('a1'),
      requestId: 'req-1', title: 'Denied', status: 'failed', decision: 'deny',
    })
    expect(row.status).toBe('fail')
  })

  it('maps a pending permission result to running', () => {
    const row = mapRow({
      id: 'ps3', kind: 'permission_result', author: makeAuthor('a1'),
      requestId: 'req-1', title: 'Pending', status: 'pending', decision: 'allow',
    })
    expect(row.status).toBe('running')
  })

  it('joins toolName and reason into apReason and ignores the decision field', () => {
    const row = mapRow({
      id: 'ps4', kind: 'permission_result', author: makeAuthor('a1'),
      requestId: 'req-1', title: 'Allowed write', status: 'completed',
      decision: 'allow', toolName: 'Write', reason: 'Approved by user',
    })
    expect(row.apReason).toBe(`Write${SEP}Approved by user`)
  })

  it('falls back to the title in apReason when reason is absent', () => {
    const row = mapRow({
      id: 'ps5', kind: 'permission_result', author: makeAuthor('a1'),
      requestId: 'req-1', title: 'Allowed write', status: 'completed',
      decision: 'allow', toolName: 'Write',
    })
    expect(row.apReason).toBe(`Write${SEP}Allowed write`)
  })
})

describe('mapBlock — run_session blocks', () => {
  it('maps a completed session with all tags', () => {
    const row = mapRow({
      id: 'rs1', kind: 'run_session', author: makeAuthor('a1'), title: 'Nightly build',
      status: 'completed', agentLabel: 'builder', runtimeLabel: 'docker', meta: 'cron',
    })
    expect(row).toEqual({
      id: 'rs1', type: 'session', label: 'Nightly build', status: 'ok',
      collapsible: true, standalone: true,
      sessionTags: ['Agent: builder', 'Runtime: docker', 'cron'],
    })
  })

  it('defaults a missing status to completed and maps it to ok', () => {
    const row = mapRow({
      id: 'rs2', kind: 'run_session', author: makeAuthor('a1'), title: 'Minimal session',
    })
    expect(row.status).toBe('ok')
  })

  it('maps a failed session to fail', () => {
    const row = mapRow({
      id: 'rs3', kind: 'run_session', author: makeAuthor('a1'), title: 'Broken', status: 'failed',
    })
    expect(row.status).toBe('fail')
  })

  it('maps a running session to running', () => {
    const row = mapRow({
      id: 'rs4', kind: 'run_session', author: makeAuthor('a1'), title: 'Active', status: 'running',
    })
    expect(row.status).toBe('running')
  })

  it('filters out absent tags and empty meta', () => {
    const row = mapRow({
      id: 'rs5', kind: 'run_session', author: makeAuthor('a1'), title: 'Bare',
      status: 'completed', meta: '',
    })
    expect(row.sessionTags).toEqual([])
  })
})

describe('mapBlock — subagent blocks', () => {
  it('maps a subagent with worker name and summary', () => {
    const row = mapRow({
      id: 'sa1', kind: 'subagent', author: makeAuthor('a1'), title: 'Lint code',
      worker: 'Linter', status: 'completed', summary: 'No issues',
    })
    expect(row).toEqual({
      id: 'sa1', type: 'sub', label: `Agent${SEP}Linter`, status: 'ok',
      collapsible: true, content: 'No issues',
    })
  })

  it('falls back to the title for content when summary is absent', () => {
    const row = mapRow({
      id: 'sa2', kind: 'subagent', author: makeAuthor('a1'), title: 'Lint code',
      worker: 'Linter', status: 'running',
    })
    expect(row.content).toBe('Lint code')
  })

  it('falls back to the title in the name when worker is empty', () => {
    const row = mapRow({
      id: 'sa3', kind: 'subagent', author: makeAuthor('a1'), title: 'Lint code',
      worker: '', status: 'running',
    })
    expect(row.label).toBe(`Agent${SEP}Lint code`)
  })

  it('falls back to the title for the label when both worker and title are empty', () => {
    const row = mapRow({
      id: 'sa5', kind: 'subagent', author: makeAuthor('a1'), title: '',
      worker: '', status: 'running',
    })
    expect(row.label).toBe('')
    expect(row.content).toBe('')
  })

  it('maps a pending subagent to running', () => {
    const row = mapRow({
      id: 'sa4', kind: 'subagent', author: makeAuthor('a1'), title: 'T', worker: 'w', status: 'pending',
    })
    expect(row.status).toBe('running')
  })
})

describe('mapBlock — subtask blocks', () => {
  it('maps a subtask using its worker for the label', () => {
    const row = mapRow({
      id: 'st1', kind: 'subtask', author: makeAuthor('a1'), title: 'Test app',
      worker: 'Tester', status: 'completed', summary: 'All green',
    })
    expect(row.type).toBe('sub')
    expect(row.label).toBe(`Agent${SEP}Tester`)
    expect(row.content).toBe('All green')
    expect(row.status).toBe('ok')
  })

  it('falls back to the title for both label and content when worker and summary are absent', () => {
    const row = mapRow({
      id: 'st2', kind: 'subtask', author: makeAuthor('a1'), title: 'Test app', status: 'running',
    })
    expect(row.label).toBe(`Agent${SEP}Test app`)
    expect(row.content).toBe('Test app')
  })
})

describe('mapBlock — child_agent blocks', () => {
  it('maps a child agent using its agent field for the label', () => {
    const row = mapRow({
      id: 'ca1', kind: 'child_agent', author: makeAuthor('a1'), title: 'Scout repo',
      agent: 'Scout', status: 'completed', summary: 'Found 3 issues',
    })
    expect(row.type).toBe('sub')
    expect(row.label).toBe(`Agent${SEP}Scout`)
    expect(row.content).toBe('Found 3 issues')
    expect(row.status).toBe('ok')
    expect(row.collapsible).toBe(true)
  })

  it('maps a failed child agent to fail', () => {
    const row = mapRow({
      id: 'ca2', kind: 'child_agent', author: makeAuthor('a1'), title: 'Scout repo',
      agent: 'Scout', status: 'failed',
    })
    expect(row.status).toBe('fail')
  })
})

describe('mapBlock — route_decision blocks', () => {
  it('maps a route decision to a non-collapsible standalone route row', () => {
    const row = mapRow({
      id: 'rd1', kind: 'route_decision', author: makeAuthor('a1'),
      action: 'Send to Reviewer', summary: 'Needs review',
    })
    expect(row).toEqual({
      id: 'rd1', type: 'route', label: 'Send to Reviewer', status: 'ok',
      collapsible: false, standalone: true, content: 'Needs review',
    })
  })

  it('leaves content undefined when summary is absent', () => {
    const row = mapRow({
      id: 'rd2', kind: 'route_decision', author: makeAuthor('a1'), action: 'Finish',
    })
    expect(row.content).toBeUndefined()
  })
})

describe('mapBlock — context_usage blocks', () => {
  it('maps a full context usage block with all stats', () => {
    const row = mapRow({
      id: 'cu1', kind: 'context_usage', author: makeAuthor('a1'),
      inputTokens: 1234, outputTokens: 512, usagePercent: 42,
      contextLimit: 200000, cachePercent: 25, cost: '2.35', modelLabel: 'gpt-4o',
    })
    expect(row).toEqual({
      id: 'cu1', type: 'ctx', label: '', status: 'ok',
      collapsible: true, standalone: true, ctxPct: 42,
      ctxStats: [
        'in: 1.2k',
        'out: 0.5k',
        'limit: 200k',
        'cache: 25%',
        '2.35',
        'gpt-4o',
      ],
    })
  })

  it('defaults ctxPct to 0 when usagePercent is missing', () => {
    const row = mapRow({
      id: 'cu2', kind: 'context_usage', author: makeAuthor('a1'),
      inputTokens: 1000, outputTokens: 500,
    })
    expect(row.ctxPct).toBe(0)
  })

  it('filters out falsy limit, cache, cost and model stats', () => {
    const row = mapRow({
      id: 'cu3', kind: 'context_usage', author: makeAuthor('a1'),
      inputTokens: 1000, outputTokens: 500, usagePercent: 0,
      contextLimit: 0, cachePercent: 0, cost: '', modelLabel: '',
    })
    expect(row.ctxPct).toBe(0)
    expect(row.ctxStats).toEqual(['in: 1.0k', 'out: 0.5k'])
  })

  it('rounds context limit to whole kilobytes without decimals', () => {
    const row = mapRow({
      id: 'cu4', kind: 'context_usage', author: makeAuthor('a1'),
      inputTokens: 0, outputTokens: 0, contextLimit: 128000,
    })
    expect(row.ctxStats).toEqual(['in: 0.0k', 'out: 0.0k', 'limit: 128k'])
  })
})

describe('mapBlock — deploy blocks', () => {
  it('maps a ready deploy with full metadata', () => {
    const row = mapRow({
      id: 'dp1', kind: 'deploy', author: makeAuthor('a1'), runId: 'run-1',
      status: 'ready', deployType: 'static', path: '/out', artifactId: 'art-1',
      url: 'https://site.example.com',
    })
    expect(row).toEqual({
      id: 'dp1', type: 'deploy', label: '', status: 'ok',
      collapsible: true, standalone: true,
      url: 'https://site.example.com',
      deployMeta: `ready${SEP}static${SEP}/out${SEP}art-1`,
    })
  })

  it('falls back to a Deployed meta when all meta parts are absent', () => {
    const row = mapRow({
      id: 'dp2', kind: 'deploy', author: makeAuthor('a1'), runId: 'run-2',
    })
    expect(row.status).toBe('ok')
    expect(row.deployMeta).toBe('Deployed')
    expect(row.url).toBeUndefined()
  })

  it('maps a failed deploy to fail', () => {
    const row = mapRow({
      id: 'dp3', kind: 'deploy', author: makeAuthor('a1'), runId: 'run-3', status: 'failed',
    })
    expect(row.status).toBe('fail')
    expect(row.deployMeta).toBe('failed')
  })

  it('maps a pending deploy to running', () => {
    const row = mapRow({
      id: 'dp4', kind: 'deploy', author: makeAuthor('a1'), runId: 'run-4', status: 'pending',
    })
    expect(row.status).toBe('running')
  })

  it('maps a deploying deploy to running', () => {
    const row = mapRow({
      id: 'dp5', kind: 'deploy', author: makeAuthor('a1'), runId: 'run-5', status: 'deploying',
    })
    expect(row.status).toBe('running')
  })

  it('maps a deployed deploy to ok', () => {
    const row = mapRow({
      id: 'dp6', kind: 'deploy', author: makeAuthor('a1'), runId: 'run-6', status: 'deployed',
    })
    expect(row.status).toBe('ok')
  })
})

describe('mapBlock — attachment blocks', () => {
  it('maps an image attachment with a rounded KB size and keeps the image marker + ref (#1938)', () => {
    const attachmentRef = { id: 'att-1', name: 'photo.png', size: 2048, mime_type: 'image/png' }
    const row = mapRow({
      id: 'at1', kind: 'attachment', author: makeAuthor('a1'),
      attachmentRef,
      contentType: 'image',
    })
    expect(row).toEqual({
      id: 'at1', type: 'attachment', label: 'photo.png', extra: 'image', status: 'ok',
      collapsible: false, standalone: true,
      fileName: 'photo.png', fileSize: '2 KB',
      attachmentKind: 'image', attachmentRef,
    })
  })

  it('omits fileSize for a zero-size attachment and marks it as a file row (#1938)', () => {
    const attachmentRef = { id: 'att-2', name: 'empty.txt', size: 0, mime_type: 'text/plain' }
    const row = mapRow({
      id: 'at2', kind: 'attachment', author: makeAuthor('a1'),
      attachmentRef,
      contentType: 'file',
    })
    expect(row.fileSize).toBeUndefined()
    expect(row.extra).toBe('file')
    expect(row.attachmentKind).toBe('file')
    expect(row.attachmentRef).toEqual(attachmentRef)
  })

  it('rounds a fractional KB size to the nearest integer', () => {
    const row = mapRow({
      id: 'at3', kind: 'attachment', author: makeAuthor('a1'),
      attachmentRef: { id: 'att-3', name: 'doc.md', size: 1536, mime_type: 'text/markdown' },
      contentType: 'file',
    })
    expect(row.fileSize).toBe('2 KB')
  })

  it('derives the audio kind from the Hub mime for file attachments (#1939)', () => {
    const attachmentRef = { id: 'att-4', name: 'voice.mp3', size: 2048, mime_type: 'audio/mpeg' }
    const row = mapRow({
      id: 'at4', kind: 'attachment', author: makeAuthor('a1'),
      attachmentRef,
      contentType: 'file',
    })
    expect(row.attachmentKind).toBe('audio')
    expect(row.attachmentRef).toEqual(attachmentRef)
  })

  it('derives the video kind from the Hub mime for file attachments (#1939)', () => {
    const row = mapRow({
      id: 'at5', kind: 'attachment', author: makeAuthor('a1'),
      attachmentRef: { id: 'att-5', name: 'demo.mp4', size: 4096, mime_type: 'video/mp4' },
      contentType: 'file',
    })
    expect(row.attachmentKind).toBe('video')
  })

  it('falls back to the filename extension when the stored mime is generic (#1939)', () => {
    const video = mapRow({
      id: 'at6', kind: 'attachment', author: makeAuthor('a1'),
      attachmentRef: { id: 'att-6', name: 'clip.MP4', size: 4096, mime_type: 'application/octet-stream' },
      contentType: 'file',
    })
    expect(video.attachmentKind).toBe('video')

    const audio = mapRow({
      id: 'at7', kind: 'attachment', author: makeAuthor('a1'),
      attachmentRef: { id: 'att-7', name: 'voice.ogg', size: 1024, mime_type: '' },
      contentType: 'file',
    })
    expect(audio.attachmentKind).toBe('audio')
  })

  it('keeps an explicit image content type on the image kind regardless of name (#1939)', () => {
    const row = mapRow({
      id: 'at8', kind: 'attachment', author: makeAuthor('a1'),
      attachmentRef: { id: 'att-8', name: 'weird.mp3.png', size: 10, mime_type: 'image/png' },
      contentType: 'image',
    })
    expect(row.attachmentKind).toBe('image')
  })
})

describe('mapBlock — failure blocks', () => {
  it('uses the reason as content when present', () => {
    const row = mapRow({
      id: 'fl1', kind: 'failure', author: makeAuthor('a1'), title: 'Error', reason: 'boom',
    })
    expect(row).toEqual({
      id: 'fl1', type: 'think', label: '', status: 'fail', collapsible: true, content: 'boom',
    })
  })

  it('falls back to the title when reason is absent', () => {
    const row = mapRow({
      id: 'fl2', kind: 'failure', author: makeAuthor('a1'), title: 'Timed out',
    })
    expect(row.content).toBe('Timed out')
  })

  it('falls back to the default failure text when both are empty', () => {
    const row = mapRow({
      id: 'fl3', kind: 'failure', author: makeAuthor('a1'), title: '', reason: '',
    })
    expect(row.content).toBe('运行失败')
  })
})

describe('mapBlock — preview blocks', () => {
  it('extracts the domain and derives the title from the URL', () => {
    const row = mapRow({
      id: 'pv1', kind: 'preview', author: makeAuthor('a1'),
      previewId: 'pv-1', status: 'completed', url: 'https://www.github.com/user/repo',
    })
    expect(row).toEqual({
      id: 'pv1', type: 'preview', label: '', status: 'ok',
      collapsible: false, standalone: true,
      url: 'https://www.github.com/user/repo',
      previewDomain: 'github.com', previewTitle: 'repo',
    })
  })

  it('falls back to the previewId as title when the URL is absent', () => {
    const row = mapRow({
      id: 'pv2', kind: 'preview', author: makeAuthor('a1'),
      previewId: 'pv-2', status: 'pending',
    })
    expect(row.previewDomain).toBe('')
    expect(row.previewTitle).toBe('pv-2')
    expect(row.url).toBeUndefined()
    expect(row.status).toBe('running')
  })

  it('maps a failed preview to fail', () => {
    const row = mapRow({
      id: 'pv3', kind: 'preview', author: makeAuthor('a1'),
      previewId: 'pv-3', status: 'failed', url: 'https://example.com/',
    })
    expect(row.status).toBe('fail')
  })

  it('falls back to the domain when the URL path has no segments', () => {
    const row = mapRow({
      id: 'pv4', kind: 'preview', author: makeAuthor('a1'),
      previewId: 'pv-4', status: 'completed', url: 'https://example.com/',
    })
    expect(row.previewDomain).toBe('example.com')
    expect(row.previewTitle).toBe('example.com')
  })

  it('survives an invalid URL by echoing it into domain and title', () => {
    const row = mapRow({
      id: 'pv5', kind: 'preview', author: makeAuthor('a1'),
      previewId: 'pv-5', status: 'completed', url: 'not a valid url',
    })
    expect(row.previewDomain).toBe('not a valid url')
    expect(row.previewTitle).toBe('not a valid url')
  })
})

describe('mapBlock — skipped kinds', () => {
  it('returns null for a result block', () => {
    expect(mapBlock({ id: 'r1', kind: 'result', author: makeAuthor('a1'), success: true })).toBeNull()
  })

  it('returns null for a finished block', () => {
    expect(mapBlock({ id: 'f1', kind: 'finished', author: makeAuthor('a1'), title: 'Done' })).toBeNull()
  })

  it('returns null for a replay_gap block', () => {
    expect(mapBlock({
      id: 'rg1', kind: 'replay_gap', author: makeAuthor('a1'), replayedCount: 3,
    })).toBeNull()
  })

  it('returns null for an agent_timeline block', () => {
    expect(mapBlock({
      id: 'tl1', kind: 'agent_timeline', author: makeAuthor('a1'),
      items: [{ label: 'Step', status: 'completed' }],
    })).toBeNull()
  })

  it('returns null for a run_step_group block', () => {
    expect(mapBlock({
      id: 'g1', kind: 'run_step_group', author: makeAuthor('a1'),
      icon: '>', title: 'Group', status: 'completed', children: [],
    })).toBeNull()
  })

  it('returns null for a compact_boundary block', () => {
    expect(mapBlock({ id: 'cb1', kind: 'compact_boundary', author: makeAuthor('a1') })).toBeNull()
  })

  it('returns null for an unknown block kind', () => {
    const unknown = {
      id: 'x1', kind: '__unknown_kind__' as unknown as TranscriptBlock['kind'], author: makeAuthor('a1'),
    } as TranscriptBlock
    expect(mapBlock(unknown)).toBeNull()
  })
})
