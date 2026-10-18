import { describe, it, expect } from 'vitest'
import { blocksToTranscriptItems } from './adapter'
import type { AgentTranscriptBlock } from './index'
import type { TranscriptBlock } from '../transcript/types'
import { makeAuthor, makeUser, makeTime, DEFAULT_AGENT_NAME } from './adapter-test-helpers'

describe('blocksToTranscriptItems (regressions)', () => {
  // Regression tests for transcript adapter edge cases
  // ═══════════════════════════════════════════════════════════════════════

  it('tool_call with status=failed should show as fail, not running', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'failed' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('tool')
    expect(row.status).toBe('fail')
  })

  it('tool_call with status=failed should stay fail even with completed evidenceRefs', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: 'Read', status: 'failed',
        evidenceRefs: [{ id: 'er1', kind: 'tool' as const, label: 'Logs', status: 'completed' as const }],
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // The failed block status takes precedence over evidence refs
    expect(row.status).toBe('fail')
  })

  it('approval block should use title when reason is undefined', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'ap1', kind: 'approval', createdAt: makeTime(1), author: makeAuthor('b1'),
        title: 'Deploy to production', status: 'pending',
        // reason not set — should fall back to title in apReason
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // With no reason set, apReason falls back to the title
    expect(row.apReason).toContain('Deploy to production')
  })

  it('agent_timeline item with status done should show as ok, not running', () => {
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
    expect(row.status).toBe('ok')
  })

  it('agent_timeline item with status todo should not show as running', () => {
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
    // 'todo' should arguably be 'waiting' or some distinct state, but at minimum
    // it shouldn't be 'running' which implies in-progress work.
    // Since RowItem.status has 'running' | 'ok' | 'fail' | 'waiting',
    // 'waiting' is the best fit for 'todo'.
    expect(row.status).toBe('waiting')
  })

  it('null author on agent text block should not crash', () => {
    const blocks = [
      { id: 't1', kind: 'text' as const, createdAt: makeTime(1), author: null as unknown as TranscriptBlock['author'], text: 'hello' },
    ] as TranscriptBlock[]
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  it('null author on thinking block should not crash', () => {
    const blocks = [
      { id: 'th1', kind: 'thinking' as const, createdAt: makeTime(1), author: null as unknown as TranscriptBlock['author'], content: 'x', isThinking: true },
    ] as TranscriptBlock[]
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  it('user text with null author should not crash on author.name access', () => {
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

  it('tool_result with failed status should be reflected after merge', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Bash', status: 'running' },
      { id: 'tr1', kind: 'tool_result', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Bash', status: 'failed', summary: 'exit code 1' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // The merge must preserve the failed status from the result.
    expect(row.status).toBe('fail')
    expect(row.isResult).toBe(true)
  })

  it('tool_result should pair with the correct tool_call when multiple share the same toolName', () => {
    // Two Read calls, then two Read results. The first result should pair with the first call.
    const blocks: TranscriptBlock[] = [
      { id: 'tc_read1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'), toolName: 'Read', status: 'running', target: '/file1.ts' },
      { id: 'tc_read2', kind: 'tool_call', createdAt: makeTime(2), author: makeAuthor('b1'), toolName: 'Read', status: 'running', target: '/file2.ts' },
      { id: 'tr_read1', kind: 'tool_result', createdAt: makeTime(3), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'content of file1' },
      { id: 'tr_read2', kind: 'tool_result', createdAt: makeTime(4), author: makeAuthor('b1'), toolName: 'Read', status: 'completed', summary: 'content of file2' },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows!
    // Both Read calls must be resolved with their respective results.
    expect(rows).toHaveLength(2)
    // Both should have isResult: true since each has its own result
    expect(rows[0]!.isResult).toBe(true)
    expect(rows[1]!.isResult).toBe(true)
    // Content should match respective results
    expect(rows[0]!.content).toBe('content of file1')
    expect(rows[1]!.content).toBe('content of file2')
  })

  it('statusNorm should not silently map undefined to ok', () => {
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
    // An undefined/missing status is ambiguous; it must not be reported as 'ok'.
    expect(row.status).not.toBe('ok')
  })

  it('thinking block with empty content should produce empty string, not crash', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: '', isThinking: true },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.type).toBe('think')
    expect(row.content).toBe('')
  })

  it('thinking block with isThinking=false should show ok status with empty content', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: undefined, isThinking: false },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    expect(row.status).toBe('ok')
    // Undefined content normalizes to ''.
    expect(row.content).toBe('')
  })

  it('context_usage with NaN usagePercent should not produce NaN in ctxPct', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'cu1', kind: 'context_usage', createdAt: makeTime(1), author: makeAuthor('b1'),
        inputTokens: 0, outputTokens: 0, usagePercent: NaN,
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // NaN is falsy, so usagePercent normalizes to 0.
    expect(row.ctxPct).toBe(0)
  })

  it('attachment with zero size should omit fileSize, not show "0 KB"', () => {
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

  it('diff block patch with only context lines should produce all ctx type lines', () => {
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

  it('failure with empty reason and empty title falls to default Chinese text', () => {
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

  it('run_step_group children with their own author should use parent author for grouping', () => {
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

  it('deploy with status=failed and no extra metadata shows fail status and default meta', () => {
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

  it('deploy with ready status should map to ok', () => {
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

  it('subagent with empty title and no summary should not crash', () => {
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

  it('file_change with empty path should produce empty content and extra', () => {
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

  it('tool_call with undefined toolName should not crash on toLowerCase', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tc1', kind: 'tool_call', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: undefined as unknown as string, status: 'running',
      },
    ] as TranscriptBlock[]
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  it('tool_result with undefined toolName should not crash on toLowerCase', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tr1', kind: 'tool_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: undefined as unknown as string, status: 'completed', summary: 'ok',
      },
    ] as TranscriptBlock[]
    expect(() => blocksToTranscriptItems(blocks)).not.toThrow()
  })

  it('thinking block with isThinking=false shows ok while earlier thinking=true showed running', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'th1', kind: 'thinking', createdAt: makeTime(1), author: makeAuthor('b1'), content: 'Plan', isThinking: true },
      { id: 'th2', kind: 'thinking', createdAt: makeTime(2), author: makeAuthor('b1'), content: 'Refined plan', isThinking: false },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const rows = (items[0] as AgentTranscriptBlock).rows!
    expect(rows).toHaveLength(2)
    expect(rows[0]!.status).toBe('running')
    expect(rows[1]!.status).toBe('ok')
    // Earlier thinking rows keep their historical 'running' status; completion
    // does not back-update them.
  })

  it('permission_request without toolName or risk should still show reason', () => {
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
    // toolName and risk are undefined here, so apReason is just the reason.
    expect(row.apReason).toBe('Needs to read sensitive data')
  })

  it('permission_result without reason should show title in apReason', () => {
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
    // With no reason, apReason falls back to the title even though toolName is set.
    expect(row.apReason).toContain('Allowed write')
    expect(row.apReason).toContain('Write')
  })

  it('agent_timeline item with undefined detail should not append "undefined"', () => {
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
    // With undefined detail the OR yields 'Check: '; the trailing ': ' is cosmetic.
    expect(row.content).toBe('Check: ')
  })

  it('statusNorm should not silently treat unrecognized status as ok', () => {
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
    // Unrecognized status must not be silently treated as success.
    expect(row.status).not.toBe('ok')
  })

  it('context_usage with contextLimit=0 should omit limit stat', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'cu1', kind: 'context_usage', createdAt: makeTime(1), author: makeAuthor('b1'),
        inputTokens: 1000, outputTokens: 500, contextLimit: 0,
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).standaloneRows![0]!
    // contextLimit 0 is falsy, so no limit stat is emitted.
    expect(row.ctxStats).not.toContain('limit: 0k')
  })

  it('tool_result with undefined summary should have undefined content', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'tr1', kind: 'tool_result', createdAt: makeTime(1), author: makeAuthor('b1'),
        toolName: 'Read', status: 'completed',
        // summary is undefined
      },
    ] as TranscriptBlock[]
    const items = blocksToTranscriptItems(blocks)
    const row = (items[0] as AgentTranscriptBlock).rows![0]!
    // RowItem.content is optional, so an absent summary stays undefined.
    expect(row.content).toBeUndefined()
  })

  it('artifact with action=modified should map to mod fileOp', () => {
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

  it('run_session with no optional labels should produce empty sessionTags array', () => {
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
  // EDGE CASE TESTS
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

})
