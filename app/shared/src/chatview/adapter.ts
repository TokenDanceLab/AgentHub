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
      } as RowItem
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
        content: t.summary || t.target,
        extra: t.target && !t.summary ? t.target : undefined,
      } as RowItem
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
      } as RowItem
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
      } as RowItem
    }

    // ── Artifact ──
    case 'artifact': {
      const a = b as ArtifactTranscriptBlock
      const extraParts = [a.path || a.title]
      if (a.uri) extraParts.push(a.uri)
      if (a.mimeType) extraParts.push(a.mimeType)
      const extra = extraParts.filter(Boolean).join(' · ')
      return {
        id: a.id, type: 'file',
        label: '',
        extra,
        status: 'ok',
        collapsible: true,
        fileOp: a.action === 'deleted' ? 'del' : a.action === 'created' ? 'cr' : 'mod',
        content: (a.path || a.title)?.split('.').pop()?.toUpperCase() || a.artifactKind || '',
      } as RowItem
    }

    // ── Diff ──
    case 'diff': {
      const d = b as DiffTranscriptBlock
      const ext = d.files?.[0]?.split('.').pop()?.toUpperCase() || ''
      const stats: string[] = [ext]
      if (d.additions !== undefined) stats.push(`+${d.additions}`)
      if (d.deletions !== undefined) stats.push(`-${d.deletions}`)
      return {
        id: d.id, type: 'file',
        label: d.title,
        extra: d.files?.[0] || '',
        status: 'ok',
        collapsible: true,
        fileOp: 'mod',
        content: stats.filter(Boolean).join(' '),
        diffLines: d.patch ? d.patch.split('\n').slice(0, 40).map(line => ({
          type: (line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx') as 'add' | 'del' | 'ctx',
          text: line,
        })) : undefined,
      } as RowItem
    }

    // ── Approval ──
    case 'approval':
    case 'permission_request':
    case 'permission_result': {
      const a = b as ApprovalTranscriptBlock
      const parts: string[] = []
      if (a.toolName) parts.push(a.toolName)
      if (a.risk) parts.push(a.risk)
      const baseReason = (a as any).reason || a.title
      parts.push(baseReason)
      return {
        id: a.id, type: 'approval',
        label: a.title,
        status: a.status === 'completed' ? 'ok' : 'waiting',
        collapsible: true, standalone: true,
        apReason: parts.filter(Boolean).join(' · '),
      } as RowItem
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
      } as RowItem
    }

    // ── Sub-agent / subtask / child_agent ──
    case 'subagent':
    case 'subtask':
    case 'child_agent': {
      const s = b as SubagentTranscriptBlock
      const name = (s as any).kind === 'child_agent' ? (s as any).agent : s.worker || s.title
      return {
        id: s.id, type: 'sub',
        label: name ? `Agent · ${name}` : s.title,
        status: statusNorm(s.status),
        collapsible: true,
        content: s.summary || s.title,
      } as RowItem
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
      } as RowItem
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
          c.cachePercent ? `缓存 ${c.cachePercent}%` : '',
          c.cost || '',
          c.modelLabel || '',
        ].filter(Boolean),
      } as RowItem
    }

    // ── Deploy ──
    case 'deploy': {
      const d = b as DeployTranscriptBlock
      const metaParts: string[] = []
      if (d.status) metaParts.push(d.status)
      if (d.deployType) metaParts.push(d.deployType)
      if (d.path) metaParts.push(d.path)
      if (d.artifactId) metaParts.push(d.artifactId)
      return {
        id: d.id, type: 'deploy',
        label: '',
        status: statusNorm(d.status || 'completed'),
        collapsible: true, standalone: true,
        url: d.url,
        deployMeta: metaParts.length > 0 ? metaParts.join(' · ') : '已部署',
      } as RowItem
    }

    // ── Attachment ──
    case 'attachment': {
      const a = b as AttachmentTranscriptBlock
      return {
        id: a.id, type: 'attachment',
        label: a.attachmentRef.name,
        extra: a.contentType,
        status: 'ok',
        collapsible: false, standalone: true,
        fileName: a.attachmentRef.name,
        fileSize: a.attachmentRef.size ? `${Math.round(a.attachmentRef.size / 1024)} KB` : undefined,
      } as RowItem
    }

    // ── Failure → error card ──
    case 'failure': {
      const f = b as any
      return {
        id: f.id, type: 'think',
        label: '',
        status: 'fail',
        collapsible: true,
        content: f.reason || f.title || '运行失败',
      } as RowItem
    }

    // ── System-only → skipped ──
    case 'result':
    case 'finished':
    case 'replay_gap':
    case 'preview':       // browser preview — not rendered in ChatView cards
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
  displayTitle?: string
  badgeLabel?: string
  badgeVariant?: 'thinking' | 'success' | 'warning' | 'danger' | 'primary'
}
export interface UserTranscriptMsg {
  type: 'user'; name?: string; time?: string; text: string
  displayTitle?: string
  badgeLabel?: string
  badgeVariant?: 'thinking' | 'success' | 'warning' | 'danger' | 'primary'
}
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
      items.push({
        type: 'user', name: block.author.name, time: timeStr(block.createdAt), text: t.text,
        ...(t.displayTitle !== undefined ? { displayTitle: t.displayTitle } as any : {}),
        ...(t.badgeLabel !== undefined ? { badgeLabel: t.badgeLabel } as any : {}),
        ...(t.badgeVariant !== undefined ? { badgeVariant: t.badgeVariant } as any : {}),
      })
      continue
    }

    // ── Agent text → bubble ──
    if ((role === 'agent' || role === 'system') && block.kind === 'text') {
      const t = block as TextTranscriptBlock
      if (!currentAgent || currentAgent.id !== block.author.id) {
        if (currentAgent) items.push(currentAgent)
        currentAgent = {
          id: block.author.id, agent: block.author.name || 'Agent', role, time: timeStr(block.createdAt),
          rows: [], bubbles: [], standaloneRows: [], runs: [],
          ...(t.displayTitle !== undefined ? { displayTitle: t.displayTitle } as any : {}),
          ...(t.badgeLabel !== undefined ? { badgeLabel: t.badgeLabel } as any : {}),
          ...(t.badgeVariant !== undefined ? { badgeVariant: t.badgeVariant } as any : {}),
        }
      }
      const bubbleText = t.displayDetail || t.text
      if (bubbleText) currentAgent!.bubbles.push(bubbleText)
      continue
    }

    // ── Agent timeline → flattened think cards ──
    if (block.kind === 'agent_timeline') {
      const t = block as any
      if (t.items && Array.isArray(t.items)) {
        for (const ti of t.items) {
          const status = ti.status === 'completed' ? 'ok' : ti.status === 'failed' ? 'fail' : 'running'
          const row = {
            id: `${block.id}-${ti.label}`, type: 'think' as const,
            label: '',
            status: status as RowItem['status'],
            collapsible: true,
            content: `${ti.label}: ${ti.detail || ''}`,
          } as RowItem
          if (!currentAgent || currentAgent.id !== block.author.id) {
            if (currentAgent) items.push(currentAgent)
            currentAgent = { id: block.author.id, agent: block.author.name || 'Agent', role, time: timeStr(block.createdAt), rows: [], bubbles: [], standaloneRows: [], runs: [] }
          }
          currentAgent.rows.push(row)
        }
      }
      continue
    }

    // ── Nested structures → recurse ──
    if (block.kind === 'run_step_group') {
      const g = block as any
      if (g.children && Array.isArray(g.children)) {
        for (const child of g.children) {
          const childRow = mapBlock({ ...child, author: block.author })
          if (!childRow) continue
          if (!currentAgent || currentAgent.id !== block.author.id) {
            if (currentAgent) items.push(currentAgent)
            currentAgent = { id: block.author.id, agent: block.author.name || 'Agent', role, time: timeStr(block.createdAt), rows: [], bubbles: [], standaloneRows: [], runs: [] }
          }
          currentAgent.rows.push(childRow)
        }
      }
      continue
    }

    // ── Structured → rows ──
    if (role === 'agent' || role === 'system') {
      const row = mapBlock(block)
      if (!row) continue
      if (!currentAgent || currentAgent.id !== block.author.id) {
        if (currentAgent) items.push(currentAgent)
        currentAgent = { id: block.author.id, agent: block.author.name || 'Agent', role, time: timeStr(block.createdAt), rows: [], bubbles: [], standaloneRows: [], runs: [] }
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
