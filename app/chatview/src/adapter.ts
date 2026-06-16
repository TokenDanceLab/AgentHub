/* ═══════════════════════════════════════════════════════════════════════
   ADAPTER — AgentHub TranscriptBlock[] → ChatView TranscriptItem[]
   ══════════════════════════════════════════════════════════════════════ */

import type { TranscriptItem, AgentBlock, RowItem, UserMsg } from '../data/mock'

// Re-export for convenience
export type { TranscriptItem, AgentBlock, RowItem, UserMsg }

/** Minimal TranscriptBlock type — mirrors AgentHub shared/transcript/types.ts */
interface BlockBase {
  id: string
  author?: { id: string; name: string; role: 'human' | 'agent' | 'system' }
  createdAt?: string
}

interface TextBlock extends BlockBase { kind: 'text'; text: string; displayTitle?: string }
interface ThinkingBlock extends BlockBase { kind: 'thinking'; content?: string; isThinking?: boolean }
interface ToolCallBlock extends BlockBase { kind: 'tool_call'; toolName: string; status: string; summary?: string }
interface ToolResultBlock extends BlockBase { kind: 'tool_result'; toolName: string; status: string; summary?: string }
interface ArtifactBlock extends BlockBase { kind: 'artifact'; title: string; path?: string; action?: string; additions?: number; deletions?: number }
interface FileChangeBlock extends BlockBase { kind: 'file_change'; path: string; action: string; additions?: number; deletions?: number; patch?: string }
interface DiffBlock extends BlockBase { kind: 'diff'; title: string; additions?: number; deletions?: number; patch?: string; files?: string[] }
interface ApprovalBlock extends BlockBase { kind: 'approval'; title: string; status: string; reason?: string }
interface RunSessionBlock extends BlockBase { kind: 'run_session'; title: string; agentLabel?: string; runtimeLabel?: string; status?: string }
interface SubagentBlock extends BlockBase { kind: 'subagent' | 'subtask' | 'child_agent'; title: string; worker?: string; agent?: string; status: string; summary?: string }
interface RouteDecisionBlock extends BlockBase { kind: 'route_decision'; action: string; summary?: string; targetAgent?: string }
interface ContextUsageBlock extends BlockBase { kind: 'context_usage'; inputTokens: number; outputTokens: number; usagePercent?: number; contextLimit?: number; modelLabel?: string }
interface DeployBlock extends BlockBase { kind: 'deploy'; status?: string; url?: string }
interface AttachmentBlock extends BlockBase { kind: 'attachment'; attachmentRef: string }
interface ReplayGapBlock extends BlockBase { kind: 'replay_gap'; replayedCount: number }
interface ResultBlock extends BlockBase { kind: 'result'; success: boolean; duration?: string }
interface FailureBlock extends BlockBase { kind: 'failure'; title: string; reason?: string }
interface FinishedBlock extends BlockBase { kind: 'finished'; title: string; runId?: string }
interface AgentTimelineBlock extends BlockBase { kind: 'agent_timeline'; items: unknown[] }
interface RunStepGroupBlock extends BlockBase { kind: 'run_step_group'; title: string; status: string; children: TranscriptBlock[] }

export type TranscriptBlock =
  | TextBlock | ThinkingBlock | ToolCallBlock | ToolResultBlock
  | ArtifactBlock | FileChangeBlock | DiffBlock | ApprovalBlock
  | RunSessionBlock | SubagentBlock | RouteDecisionBlock
  | ContextUsageBlock | DeployBlock | AttachmentBlock
  | ReplayGapBlock | ResultBlock | FailureBlock | FinishedBlock
  | AgentTimelineBlock | RunStepGroupBlock

// ── Helpers ──

let _id = 0
function uid(prefix: string) { return `${prefix}-${++_id}` }

function statusNorm(s: string): RowItem['status'] {
  if (s === 'running' || s === 'pending') return 'running'
  if (s === 'failed' || s === 'rejected') return 'fail'
  if (s === 'completed' || s === 'ok' || s === 'done') return 'ok'
  return 'waiting'
}

// ── Block → RowItem mapper ──

function mapBlock(b: TranscriptBlock): RowItem | null {
  switch (b.kind) {
    case 'thinking':
      return {
        id: b.id, type: 'think',
        label: b.isThinking ? '思考' : '思考完成',
        status: b.isThinking ? 'running' : 'ok',
        collapsible: true,
        content: b.content || '',
      }

    case 'tool_call':
      return {
        id: b.id, type: 'tool',
        label: b.toolName,
        status: 'running',
        collapsible: true,
        toolName: b.toolName.toLowerCase(),
        content: b.summary,
      }

    case 'tool_result':
      return {
        id: b.id, type: 'tool',
        label: b.toolName,
        status: statusNorm(b.status),
        collapsible: true,
        toolName: b.toolName.toLowerCase(),
        content: b.summary,
        isResult: true,
      }

    case 'artifact':
    case 'file_change':
      return {
        id: b.id, type: 'file',
        label: b.kind === 'artifact' ? (b.action === 'delete' ? '删除' : b.action === 'create' ? '创建' : '修改') : (b.action === 'delete' ? '删除' : '修改'),
        extra: b.kind === 'artifact' ? (b.path || b.title) : b.path,
        status: 'ok',
        collapsible: true,
        fileOp: b.kind === 'artifact' ? (b.action === 'delete' ? 'del' : b.action === 'create' ? 'cr' : 'mod') : (b.action === 'delete' ? 'del' : 'mod'),
        content: b.kind === 'artifact' ? (b.path?.split('.').pop()?.toUpperCase() || '') : '',
        ...(b.kind === 'file_change' && b.additions !== undefined ? {
          diffLines: [
            ...Array(b.additions || 0).fill(0).map((_, i) => ({ type: 'add' as const, text: `+ ... (+${b.additions} lines)` })),
          ].slice(0, 1),
        } : {}),
      }

    case 'diff':
      return {
        id: b.id, type: 'file',
        label: b.title,
        extra: b.files?.[0] || '',
        status: 'ok',
        collapsible: true,
        fileOp: 'mod',
        content: b.files?.[0]?.split('.').pop()?.toUpperCase() || '',
        diffLines: b.patch ? b.patch.split('\n').map(line => ({
          type: line.startsWith('+') ? 'add' as const : line.startsWith('-') ? 'del' as const : 'ctx' as const,
          text: line,
        })).slice(0, 30) : undefined,
      }

    case 'approval':
      return {
        id: b.id, type: 'approval',
        label: b.title,
        status: statusNorm(b.status) === 'ok' ? 'ok' : 'waiting',
        collapsible: true, standalone: true,
        apReason: b.reason || b.title,
      }

    case 'run_session':
      return {
        id: b.id, type: 'session',
        label: b.title,
        status: 'ok',
        collapsible: true, standalone: true,
        sessionTags: [
          b.agentLabel ? `Agent: ${b.agentLabel}` : '',
          b.runtimeLabel ? `Runtime: ${b.runtimeLabel}` : '',
        ].filter(Boolean),
      }

    case 'subagent':
    case 'subtask':
    case 'child_agent': {
      const name = b.kind === 'child_agent' ? b.agent : b.worker || ''
      return {
        id: b.id, type: 'sub',
        label: `Agent · ${name || b.title}`,
        status: statusNorm(b.status),
        collapsible: true,
        content: b.summary || b.title,
      }
    }

    case 'route_decision':
      return {
        id: b.id, type: 'route',
        label: b.action,
        status: 'ok',
        collapsible: false, standalone: true,
        content: b.summary,
      }

    case 'context_usage':
      return {
        id: b.id, type: 'ctx',
        label: '上下文使用',
        status: 'ok',
        collapsible: true, standalone: true,
        ctxPct: b.usagePercent || 0,
        ctxStats: [
          `输入 ${(b.inputTokens / 1000).toFixed(1)}k`,
          `输出 ${(b.outputTokens / 1000).toFixed(1)}k`,
          b.contextLimit ? `上限 ${(b.contextLimit / 1000).toFixed(0)}k` : '',
          b.modelLabel || '',
        ].filter(Boolean),
      }

    case 'deploy':
      return {
        id: b.id, type: 'deploy',
        label: '预览已就绪',
        status: statusNorm(b.status || 'ok'),
        collapsible: true, standalone: true,
        url: b.url,
        deployMeta: b.status ? `已部署 · ${b.status}` : undefined,
      }

    case 'attachment':
      return {
        id: b.id, type: 'attachment',
        label: b.attachmentRef,
        status: 'ok',
        collapsible: false, standalone: true,
        fileName: b.attachmentRef,
      }

    // System-only blocks → skip
    case 'result':
    case 'failure':
    case 'finished':
    case 'replay_gap':
      return null

    case 'agent_timeline':
    case 'run_step_group':
      // Complex nested types — skip for now, flatten children
      return null

    default:
      return null
  }
}

// ── Main adapter ──

/**
 * Convert AgentHub TranscriptBlock[] → ChatView TranscriptItem[].
 * Groups consecutive blocks from the same agent into AgentBlocks.
 * User text blocks become UserMsg entries.
 */
export function blocksToTranscript(blocks: TranscriptBlock[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  let currentAgent: AgentBlock | null = null

  for (const block of blocks) {
    const author = block.author

    // User message
    if (author?.role === 'human' && block.kind === 'text') {
      // Flush current agent
      if (currentAgent) { items.push(currentAgent); currentAgent = null }
      items.push({
        type: 'user',
        name: author.name,
        time: block.createdAt ? new Date(block.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : undefined,
        text: block.text,
      } as UserMsg)
      continue
    }

    // Agent message — start or continue agent block
    if (author?.role === 'agent' || author?.role === 'system') {
      const row = mapBlock(block)
      if (!row) {
        // Skip system blocks that don't render
        if (block.kind === 'text' && currentAgent) {
          // Agent text blocks become bubbles
          currentAgent.bubbles.push((block as TextBlock).text)
        }
        continue
      }

      const agentName = author.name || 'Agent'
      const agentId = author.id

      // Start new agent block if author changed
      if (!currentAgent || currentAgent.id !== agentId) {
        if (currentAgent) items.push(currentAgent)
        currentAgent = {
          id: uid('ag'),
          agent: agentName,
          role: 'builder', // default, can be refined
          time: block.createdAt
            ? new Date(block.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            : '',
          rows: [],
          runs: [],
          bubbles: [],
          standaloneRows: [],
        }
      }

      // Route cards and standalone cards go to standaloneRows
      if (row.type === 'route' || row.type === 'deploy' || row.type === 'ctx' || row.type === 'approval' || row.type === 'session' || row.type === 'attachment') {
        currentAgent.standaloneRows.push(row)
      } else {
        currentAgent.rows.push(row)
      }
    }
  }

  // Flush last agent
  if (currentAgent) items.push(currentAgent)

  return items
}
