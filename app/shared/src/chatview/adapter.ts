/* ═══════════════════════════════════════════════════════════════════════
   ADAPTER — AgentHub TranscriptBlock[] → ChatView TranscriptItem[]
   Uses REAL AgentHub types from shared/transcript. Zero mock types.
   ══════════════════════════════════════════════════════════════════════ */

import type {
  TranscriptBlock, TranscriptAuthorRole,
  TextTranscriptBlock, ThinkingTranscriptBlock,
  ToolCallTranscriptBlock, ToolResultTranscriptBlock,
  FileChangeTranscriptBlock, ArtifactTranscriptBlock,
  DiffTranscriptBlock, ApprovalTranscriptBlock,
  RunSessionTranscriptBlock, SubagentTranscriptBlock,
  RouteDecisionTranscriptBlock, ContextUsageTranscriptBlock,
  DeployTranscriptBlock, AttachmentTranscriptBlock,
  EvidenceRefStatus,
} from '../transcript/types'
import type { RowItem } from './data/mock'

// Re-export for consumers
export type { TranscriptBlock }

// ── Helpers ──

let _id = 0
function uid(prefix: string) { return `${prefix}-${++_id}` }
function timeStr(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function statusNorm(s: EvidenceRefStatus | string): RowItem['status'] {
  if (s === 'running' || s === 'pending') return 'running'
  if (s === 'failed') return 'fail'
  if (s === 'completed') return 'ok'
  return 'ok'
}

// ── Per-block mapper ──

function mapBlock(b: TranscriptBlock): RowItem | null {
  switch (b.kind) {
    // ── Thinking ──
    case 'thinking': {
      const t = b as ThinkingTranscriptBlock
      return {
        id: t.id, type: 'think',
        label: '',
        status: t.isThinking ? 'running' : 'ok',
        collapsible: true,
        content: t.content || '',
      }
    }

    // ── Tool call (running) ──
    case 'tool_call': {
      const t = b as ToolCallTranscriptBlock
      return {
        id: t.id, type: 'tool',
        label: t.toolName,
        status: 'running',
        collapsible: true,
        toolName: t.toolName.toLowerCase(),
        content: t.summary ?? t.target,
      }
    }

    // ── Tool result ──
    case 'tool_result': {
      const t = b as ToolResultTranscriptBlock
      return {
        id: t.id, type: 'tool',
        label: t.toolName,
        status: statusNorm(t.status),
        collapsible: true,
        toolName: t.toolName.toLowerCase(),
        content: t.summary,
        isResult: true,
      }
    }

    // ── File change ──
    case 'file_change': {
      const t = b as FileChangeTranscriptBlock
      return {
        id: t.id, type: 'file',
        label: '',
        extra: t.path,
        status: 'ok',
        collapsible: true,
        fileOp: t.action === 'created' ? 'cr' : t.action === 'deleted' ? 'del' : 'mod',
        content: t.path?.split('.').pop()?.toUpperCase() || '',
        diffLines: t.patch ? t.patch.split('\n').slice(0, 40).map(line => ({
          type: (line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx') as 'add' | 'del' | 'ctx',
          text: line,
        })) : undefined,
      }
    }

    // ── Artifact ──
    case 'artifact': {
      const a = b as ArtifactTranscriptBlock
      return {
        id: a.id, type: 'file',
        label: '',
        extra: a.path || a.title,
        status: 'ok',
        collapsible: true,
        fileOp: a.action === 'delete' ? 'del' : a.action === 'create' ? 'cr' : 'mod',
        content: (a.path || a.title)?.split('.').pop()?.toUpperCase() || a.artifactKind || '',
      }
    }

    // ── Diff ──
    case 'diff': {
      const d = b as DiffTranscriptBlock
      return {
        id: d.id, type: 'file',
        label: d.title,
        extra: d.files?.[0] || '',
        status: 'ok',
        collapsible: true,
        fileOp: 'mod',
        content: d.files?.[0]?.split('.').pop()?.toUpperCase() || '',
        diffLines: d.patch ? d.patch.split('\n').slice(0, 40).map(line => ({
          type: (line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx') as 'add' | 'del' | 'ctx',
          text: line,
        })) : undefined,
      }
    }

    // ── Approval ──
    case 'approval':
    case 'permission_request':
    case 'permission_result': {
      const a = b as ApprovalTranscriptBlock
      return {
        id: a.id, type: 'approval',
        label: a.title,
        status: a.status === 'completed' ? 'ok' : 'waiting',
        collapsible: true, standalone: true,
        apReason: (a as any).reason || a.title,
      }
    }

    // ── Run session ──
    case 'run_session': {
      const r = b as RunSessionTranscriptBlock
      return {
        id: r.id, type: 'session',
        label: r.title,
        status: 'ok',
        collapsible: true, standalone: true,
        sessionTags: [
          r.agentLabel ? `Agent: ${r.agentLabel}` : '',
          r.runtimeLabel ? `Runtime: ${r.runtimeLabel}` : '',
          r.meta || '',
        ].filter(Boolean),
      }
    }

    // ── Sub-agent / subtask / child_agent ──
    case 'subagent':
    case 'subtask': {
      const s = b as SubagentTranscriptBlock
      return {
        id: s.id, type: 'sub',
        label: '',
        status: statusNorm(s.status),
        collapsible: true,
        content: s.summary || s.title,
      }
    }

    // ── Route decision ──
    case 'route_decision': {
      const r = b as RouteDecisionTranscriptBlock
      return {
        id: r.id, type: 'route',
        label: r.action,
        status: 'ok',
        collapsible: false, standalone: true,
        content: r.summary,
      }
    }

    // ── Context usage ──
    case 'context_usage': {
      const c = b as ContextUsageTranscriptBlock
      return {
        id: c.id, type: 'ctx',
        label: '',
        status: 'ok',
        collapsible: true, standalone: true,
        ctxPct: c.usagePercent || 0,
        ctxStats: [
          `输入 ${((c.inputTokens || 0) / 1000).toFixed(1)}k`,
          `输出 ${((c.outputTokens || 0) / 1000).toFixed(1)}k`,
          c.contextLimit ? `上限 ${(c.contextLimit / 1000).toFixed(0)}k` : '',
          c.modelLabel || '',
        ].filter(Boolean),
      }
    }

    // ── Deploy ──
    case 'deploy': {
      const d = b as DeployTranscriptBlock
      return {
        id: d.id, type: 'deploy',
        label: '',
        status: statusNorm(d.status || 'completed'),
        collapsible: true, standalone: true,
        url: d.url,
        deployMeta: d.status || '已部署',
      }
    }

    // ── Attachment ──
    case 'attachment': {
      const a = b as AttachmentTranscriptBlock
      return {
        id: a.id, type: 'attachment',
        label: a.attachmentRef,
        status: 'ok',
        collapsible: false, standalone: true,
        fileName: a.attachmentRef,
      }
    }

    // ── System-only → skipped ──
    case 'result':
    case 'failure':
    case 'finished':
    case 'replay_gap':
    case 'agent_timeline':
    case 'run_step_group':
      return null

    default:
      return null
  }
}

// ── TranscriptBlock[] → TranscriptItem[] ──

export interface AgentTranscriptBlock {
  id: string; agent: string; role: string; time: string
  rows: RowItem[]; bubbles: string[]; standaloneRows: RowItem[]
  runs: never[]
}
export interface UserTranscriptMsg { type: 'user'; name?: string; time?: string; text: string }
export type ChatViewTranscriptItem = UserTranscriptMsg | AgentTranscriptBlock

export function blocksToTranscriptItems(blocks: TranscriptBlock[]): ChatViewTranscriptItem[] {
  const items: ChatViewTranscriptItem[] = []
  let currentAgent: AgentTranscriptBlock | null = null

  for (const block of blocks) {
    const role = block.author?.role ?? 'system'

    // ── User text ──
    if (role === 'human' && block.kind === 'text') {
      if (currentAgent) { items.push(currentAgent); currentAgent = null }
      const t = block as TextTranscriptBlock
      items.push({ type: 'user', name: block.author.name, time: timeStr(block.createdAt), text: t.text })
      continue
    }

    // ── Agent text → bubble ──
    if ((role === 'agent' || role === 'system') && block.kind === 'text') {
      const t = block as TextTranscriptBlock
      if (!currentAgent || currentAgent.id !== block.author.id) {
        if (currentAgent) items.push(currentAgent)
        currentAgent = { id: uid('ag'), agent: block.author.name || 'Agent', role, time: timeStr(block.createdAt), rows: [], bubbles: [], standaloneRows: [], runs: [] }
      }
      const bubbleText = t.displayDetail || t.text
      if (bubbleText) currentAgent.bubbles.push(bubbleText)
      continue
    }

    // ── Structured → rows ──
    if (role === 'agent' || role === 'system') {
      const row = mapBlock(block)
      if (!row) continue
      if (!currentAgent || currentAgent.id !== block.author.id) {
        if (currentAgent) items.push(currentAgent)
        currentAgent = { id: uid('ag'), agent: block.author.name || 'Agent', role, time: timeStr(block.createdAt), rows: [], bubbles: [], standaloneRows: [], runs: [] }
      }
      // Standalone cards vs inline rows
      const standalone = row.type === 'route' || row.type === 'deploy' || row.type === 'ctx' ||
        row.type === 'approval' || row.type === 'session' || row.type === 'attachment'
      if (standalone) currentAgent.standaloneRows.push(row)
      else currentAgent.rows.push(row)
    }
  }

  if (currentAgent) items.push(currentAgent)
  return items
}
