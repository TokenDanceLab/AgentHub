/* ═══════════════════════════════════════════════════════════════════════
   ADAPTER — TranscriptBlock[] → ChatView TranscriptItem[]
   Converts upstream TranscriptBlock types into generic ChatView items.
   ══════════════════════════════════════════════════════════════════════ */

import type {
  TranscriptBlock,
  TextTranscriptBlock, ThinkingTranscriptBlock,
  ToolCallTranscriptBlock, ToolResultTranscriptBlock,
  FileChangeTranscriptBlock, ArtifactTranscriptBlock,
  DiffTranscriptBlock, ApprovalTranscriptBlock,
  PermissionRequestTranscriptBlock, PermissionResultTranscriptBlock,
  RunSessionTranscriptBlock, SubagentTranscriptBlock,
  RouteDecisionTranscriptBlock, ContextUsageTranscriptBlock,
  DeployTranscriptBlock, AttachmentTranscriptBlock,
  FailureTranscriptBlock,
  AgentTimelineTranscriptBlock,
  RunStepGroupTranscriptBlock,
  ChildAgentTranscriptBlock, SubtaskTranscriptBlock,
  EvidenceRefStatus,
  PreviewTranscriptBlock,
} from '../transcript/types'
import type { RowItem } from './types'
import type { TranscriptItem, TranscriptUserItem, TranscriptAgentItem } from './transcript-item'

// Re-export for consumers
export type { TranscriptBlock }

// ── Constants ──

/** Separator used to join display parts (e.g. `'Agent · Linter'`, `'Read · medium · reason'`). */
export const SEP = ' · '

// ── Helpers ──

/**
 * Convert a unified-diff `patch` string into an array of line objects
 * suitable for rendering in the transcript's diff viewer.
 *
 * Truncates to `maxLines` lines (default 40) to avoid huge diffs
 * dominating the transcript.
 *
 * @param patch - A unified-diff patch string (lines starting with `+` / `-` / ` `).
 * @param maxLines - Maximum number of lines to include (default 40).
 * @returns An array of `{ type, text }` objects where type is `'add'`, `'del'`, or `'ctx'`.
 */
function patchToDiffLines(patch: string, maxLines = 40) {
  return patch.split('\n').slice(0, maxLines).map(line => ({
    type: (line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx') as 'add' | 'del' | 'ctx',
    text: line,
  }))
}

/**
 * Extract optional display-override fields from a block.
 * Picks `displayTitle`, `badgeLabel`, and `badgeVariant` when present.
 * Used to propagate display annotations from upstream blocks into
 * {@link TranscriptUserItem} and {@link TranscriptAgentItem}.
 */
function pickDisplay(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (b.displayTitle !== undefined) out.displayTitle = b.displayTitle
  if (b.badgeLabel !== undefined) out.badgeLabel = b.badgeLabel
  if (b.badgeVariant !== undefined) out.badgeVariant = b.badgeVariant
  return out
}

/**
 * Create a new {@link TranscriptAgentItem} with empty row/bubble/standalone arrays.
 *
 * @param author - The block's author metadata (id, name, role).
 * @param role - The agent's role string (e.g. `'builder'`, `'reviewer'`).
 * @param createdAt - ISO timestamp string for the time display.
 * @returns A fresh agent block ready to accumulate rows and bubbles.
 */
function newAgentBlock(author: TranscriptBlock['author'], role: string, createdAt?: string): TranscriptAgentItem {
  return {
    id: author?.id ?? 'unknown',
    agent: author?.name || 'Agent',
    role,
    time: timeStr(createdAt),
    rows: [],
    bubbles: [],
    standaloneRows: [],
    runs: [],
  }
}

/**
 * Format an ISO timestamp into a locale-aware time string (HH:MM).
 * Falls back to `'en-US'` when `navigator` is not available (e.g. SSR).
 *
 * @param iso - ISO 8601 date string (e.g. `'2026-06-17T14:30:00.000Z'`).
 * @returns A formatted time string like `'14:30'` or an empty string if input is falsy.
 */
function timeStr(iso?: string) {
  if (!iso) return ''
  const locale = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/**
 * Canonical mapper from {@link EvidenceRefStatus} (or generic status string)
 * to {@link RowItem} status.
 *
 * Mapping:
 * - `'running'` / `'pending'`  -> `'running'`
 * - `'failed'`                 -> `'fail'`
 * - `'completed'`              -> `'ok'`
 * - Everything else            -> `'ok'`
 */
function statusNorm(s: EvidenceRefStatus | string | undefined): RowItem['status'] {
  if (!s) return 'running'
  if (s === 'running' || s === 'pending') return 'running'
  if (s === 'failed') return 'fail'
  if (s === 'completed') return 'ok'
  return 'running'
}

/**
 * Deploy-specific status mapper. Handles deploy lifecycle states that
 * differ from the generic {@link EvidenceRefStatus} set.
 *
 * Mapping:
 * - `'failed'`                 -> `'fail'`
 * - `'pending'` / `'deploying'` -> `'running'`
 * - `'ready'` / `'deployed'`   -> `'ok'`
 * - `undefined` / other        -> `'ok'`
 */
function deployStatusNorm(s?: string): RowItem['status'] {
  if (!s) return 'ok'
  if (s === 'failed') return 'fail'
  if (s === 'pending' || s === 'deploying') return 'running'
  if (s === 'ready' || s === 'deployed') return 'ok'
  return 'ok'
}

/**
 * Extract a human-readable domain from a URL string (without www. prefix).
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Derive a display title from a URL path segment when no explicit title is provided.
 */
function deriveTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname
      .replace(/\/$/, '')
      .split('/')
      .filter(Boolean)
      .pop()
    if (!path) return extractDomain(url)
    const decoded = decodeURIComponent(path)
      .replace(/[-_]/g, ' ')
      .replace(/\.\w+$/, '')
    return decoded.length > 60 ? decoded.slice(0, 57) + '...' : decoded
  } catch {
    return url
  }
}

/**
 * Map a single {@link TranscriptBlock} to a {@link RowItem}, or return `null`
 * if the block kind should be skipped (e.g. `'result'`, `'finished'`,
 * `'replay_gap'`, `'agent_timeline'`, `'run_step_group'`).
 *
 * Status mapping conventions (see the block comment above for full rationale):
 * - `'running'` -- in-flight / pending events (tool_call, thinking, deploy in progress)
 * - `'ok'`      -- finished / terminal events (tool_result, file_change, artifact, diff, etc.)
 * - `'fail'`    -- error events (failure, failed deploy, failed approval)
 * - `'waiting'` -- awaiting user input (permission_request)
 *
 * Uses {@link statusNorm} and {@link deployStatusNorm} for canonical
 * EvidenceRefStatus -> RowItem status conversion.
 */
function mapBlock(b: TranscriptBlock): RowItem | null {
  switch (b.kind) {
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

    case 'tool_call': {
      const t = b as ToolCallTranscriptBlock
      // Tool call is a running event by nature, but a completed transcript
      // may carry status:'completed' or evidenceRefs showing completion.
      const hasCompletedEvidence = t.evidenceRefs?.some(ref => ref.status === 'completed')
      const toolStatus = t.status === 'failed'
        ? 'fail'
        : (t.status === 'completed' || hasCompletedEvidence)
          ? 'ok'
          : 'running'
      const tn = t.toolName?.toLowerCase() ?? 'unknown'
      return {
        id: t.id, type: 'tool',
        label: t.toolName ?? tn,
        status: toolStatus,
        collapsible: true,
        toolName: tn,
        content: t.summary || t.target,
        extra: t.target && !t.summary ? t.target : undefined,
      } as RowItem
    }

    case 'tool_result': {
      const t = b as ToolResultTranscriptBlock
      const tn = t.toolName?.toLowerCase() ?? 'unknown'
      return {
        id: t.id, type: 'tool',
        label: t.toolName ?? tn,
        status: statusNorm(t.status),
        collapsible: true,
        toolName: tn,
        content: t.summary,
        isResult: true,
      } as RowItem
    }

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
        diffLines: t.patch ? patchToDiffLines(t.patch) : undefined,
      } as RowItem
    }

    case 'artifact': {
      const a = b as ArtifactTranscriptBlock
      const extraParts = [a.path || a.title]
      if (a.uri) extraParts.push(a.uri)
      if (a.mimeType) extraParts.push(a.mimeType)
      const extra = extraParts.filter(Boolean).join(SEP)
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
        diffLines: d.patch ? patchToDiffLines(d.patch) : undefined,
      } as RowItem
    }

    case 'approval':
    case 'permission_request':
    case 'permission_result': {
      const a = b as ApprovalTranscriptBlock | PermissionRequestTranscriptBlock | PermissionResultTranscriptBlock
      const parts: string[] = []
      if (a.toolName) parts.push(a.toolName)
      if ('risk' in a && a.risk) parts.push(a.risk)
      const baseReason = 'reason' in a ? a.reason : (a as ApprovalTranscriptBlock).title
      if (baseReason) parts.push(baseReason)
      // Permission requests are always waiting; others use statusNorm
      const st = b.kind === 'permission_request'
        ? 'waiting'
        : statusNorm(a.status)
      return {
        id: a.id, type: 'approval',
        label: 'title' in a ? a.title : '',
        status: st,
        collapsible: true, standalone: true,
        apReason: parts.filter(Boolean).join(SEP),
      } as RowItem
    }

    case 'run_session': {
      const r = b as RunSessionTranscriptBlock
      return {
        id: r.id, type: 'session',
        label: r.title,
        status: statusNorm(r.status || 'completed'),
        collapsible: true, standalone: true,
        sessionTags: [
          r.agentLabel ? `Agent: ${r.agentLabel}` : '',
          r.runtimeLabel ? `Runtime: ${r.runtimeLabel}` : '',
          r.meta || '',
        ].filter(Boolean),
      } as RowItem
    }

    case 'subagent':
    case 'subtask':
    case 'child_agent': {
      const block = b as SubagentTranscriptBlock | SubtaskTranscriptBlock | ChildAgentTranscriptBlock
      const name = block.kind === 'child_agent' ? block.agent : block.worker || block.title
      return {
        id: block.id, type: 'sub',
        label: name ? `Agent${SEP}${name}` : block.title,
        status: statusNorm(block.status),
        collapsible: true,
        content: block.summary || block.title,
      } as RowItem
    }

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

    case 'context_usage': {
      const c = b as ContextUsageTranscriptBlock
      return {
        id: c.id, type: 'ctx',
        label: '',
        status: 'ok',
        collapsible: true, standalone: true,
        ctxPct: c.usagePercent || 0,
        ctxStats: [
          `in: ${((c.inputTokens || 0) / 1000).toFixed(1)}k`,
          `out: ${((c.outputTokens || 0) / 1000).toFixed(1)}k`,
          c.contextLimit ? `limit: ${(c.contextLimit / 1000).toFixed(0)}k` : '',
          c.cachePercent ? `cache: ${c.cachePercent}%` : '',
          c.cost || '',
          c.modelLabel || '',
        ].filter(Boolean),
      } as RowItem
    }

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
        status: deployStatusNorm(d.status),
        collapsible: true, standalone: true,
        url: d.url,
        deployMeta: metaParts.length > 0 ? metaParts.join(SEP) : 'Deployed',
      } as RowItem
    }

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

    case 'failure': {
      const f = b as FailureTranscriptBlock
      return {
        id: f.id, type: 'think',
        label: '',
        status: 'fail',
        collapsible: true,
        content: f.reason || f.title || '运行失败',
      } as RowItem
    }

    case 'preview': {
      const p = b as PreviewTranscriptBlock
      const domain = p.url ? extractDomain(p.url) : ''
      const displayTitle = p.url ? deriveTitleFromUrl(p.url) : (p.previewId || '')
      return {
        id: p.id, type: 'preview',
        label: '',
        status: statusNorm(p.status),
        collapsible: false, standalone: true,
        url: p.url,
        previewDomain: domain,
        previewTitle: displayTitle,
      } as RowItem
    }

    case 'result':
    case 'finished':
    case 'replay_gap':
    case 'agent_timeline':
    case 'run_step_group':
      return null

    default:
      return null
  }
}

/**
 * Extract evidence refs from a block into the simplified form used by
 * {@link TranscriptAgentItem}.evidenceRefs.
 */
function mapEvidenceRefs(b: TranscriptBlock): TranscriptAgentItem['evidenceRefs'] | undefined {
  if (!b.evidenceRefs || b.evidenceRefs.length === 0) return undefined
  return b.evidenceRefs
}

/**
 * Convert an array of upstream {@link TranscriptBlock} objects into
 * generic {@link TranscriptItem} objects ready for rendering.
 *
 * This is the primary integration point for ChatView. Upstream data sources
 * produce `TranscriptBlock[]`, call this function, and feed the resulting
 * `TranscriptItem[]` to the Transcript component.
 *
 * Grouping rules:
 * - Consecutive blocks with the same `author.id` are merged into one
 *   {@link TranscriptAgentItem}.
 * - User text blocks (`role === 'human'`, `kind === 'text'`) produce
 *   {@link TranscriptUserItem} entries.
 * - Agent text blocks become chat bubbles.
 * - Tool call + tool result pairs with the same `toolName` are merged into
 *   a single card (the result replaces the call).
 * - Standalone cards (route, deploy, context, approval, session, attachment)
 *   are placed in `standaloneRows` for separate rendering.
 * - `agent_timeline` items are flattened into individual think cards.
 * - `run_step_group` children are recursed into.
 *
 * @param blocks - Array of upstream transcript blocks.
 * @returns Array of generic transcript items (user messages + agent blocks).
 */
export function blocksToTranscriptItems(blocks: TranscriptBlock[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  let currentAgent: TranscriptAgentItem | null = null

  let _seq = 0
  for (const block of blocks) {
    const role = block.author?.role ?? 'system'
    _seq++
    const groupId = block.author?.id ?? 'unknown'

    // ── User text ──
    if (role === 'human' && block.kind === 'text') {
      if (currentAgent) { items.push(currentAgent); currentAgent = null }
      const t = block as TextTranscriptBlock
      items.push({
        type: 'user', name: block.author?.name, time: timeStr(block.createdAt), text: t.text,
        ...pickDisplay(t as unknown as Record<string, unknown>),
      })
      continue
    }

    // ── Agent text → bubble ──
    if ((role === 'agent' || role === 'system') && block.kind === 'text') {
      const t = block as TextTranscriptBlock
      if (!currentAgent || currentAgent.groupId !== groupId) {
        if (currentAgent) items.push(currentAgent)
        const agent: TranscriptAgentItem = Object.assign(newAgentBlock(block.author, role, block.createdAt), { groupId },
          pickDisplay(t as unknown as Record<string, unknown>),
          { evidenceRefs: mapEvidenceRefs(block) },
        )
        // Unique React key: author.id + first-block-seq
        agent.id = `${groupId}-${_seq}`
        currentAgent = agent
      }
      // currentAgent is guaranteed non-null after the block above
      const agent = currentAgent
      if (!agent) continue
      const bubbleText = t.displayDetail || t.text
      if (bubbleText) agent.bubbles.push(bubbleText)
      // Map reply-to metadata from upstream block
      if (t.replyToMessageId && !agent.replyBlockId) {
        agent.replyBlockId = t.replyToMessageId
        if (t.replyAuthor !== undefined) agent.replyAuthor = t.replyAuthor
        if (t.replyPreview !== undefined) agent.replyPreview = t.replyPreview
      }
      continue
    }

    // ── Agent timeline → flattened think cards ──
    if (block.kind === 'agent_timeline') {
      const t = block as AgentTimelineTranscriptBlock
      if (t.items && Array.isArray(t.items)) {
        for (const ti of t.items) {
          const status =
            ti.status === 'completed' || ti.status === 'done' ? 'ok' :
            ti.status === 'failed' ? 'fail' :
            ti.status === 'todo' ? 'waiting' :
            'running'
          const row = {
            id: `${block.id}-${ti.label}`, type: 'think' as const,
            label: '',
            status: status as RowItem['status'],
            collapsible: true,
            content: `${ti.label}: ${ti.detail || ''}`,
          } as RowItem
          if (!currentAgent || currentAgent.groupId !== groupId) {
            if (currentAgent) items.push(currentAgent)
            currentAgent = newAgentBlock(block.author, role, block.createdAt)
            currentAgent.groupId = groupId
            const refs = mapEvidenceRefs(block)
            if (refs) currentAgent.evidenceRefs = refs
          }
          currentAgent.rows.push(row)
        }
      }
      continue
    }

    // ── Nested structures → recurse ──
    if (block.kind === 'run_step_group') {
      const g = block as RunStepGroupTranscriptBlock
      if (g.children && Array.isArray(g.children)) {
        const childRows: RowItem[] = []
        for (const child of g.children) {
          const childRow = mapBlock({ ...child, author: block.author })
          if (!childRow) continue
          childRows.push(childRow)
        }
        if (!currentAgent || currentAgent.groupId !== groupId) {
          if (currentAgent) items.push(currentAgent)
          currentAgent = newAgentBlock(block.author, role, block.createdAt)
          currentAgent.groupId = groupId
          const refs = mapEvidenceRefs(block)
          if (refs) currentAgent.evidenceRefs = refs
        }
        // Create a parent row that wraps the children in a collapsible group
        const groupRow: RowItem = {
          id: g.id,
          type: 'sub',
          label: g.title,
          status: g.status === 'completed' ? 'ok' : g.status === 'failed' ? 'fail' : 'running',
          collapsible: true,
          open: g.open ?? false,
          children: childRows,
          extra: g.meta,
        }
        currentAgent.rows.push(groupRow)
      }
      continue
    }

    // ── Structured → rows ──
    if (role === 'agent' || role === 'system') {
      const row = mapBlock(block)
      if (!row) continue
      if (!currentAgent || currentAgent.groupId !== groupId) {
        if (currentAgent) items.push(currentAgent)
        const refs = mapEvidenceRefs(block)
        currentAgent = { id: block.author?.id ?? 'unknown', agent: block.author?.name || 'Agent', role, time: timeStr(block.createdAt), rows: [], bubbles: [], standaloneRows: [], runs: [], groupId, ...(refs ? { evidenceRefs: refs } : {}) }
        currentAgent.id = `${block.author?.id ?? 'unknown'}-${_seq}`
      }
      if (!currentAgent) continue
      // Standalone cards vs inline rows
      const standalone = row.type === 'route' || row.type === 'deploy' || row.type === 'ctx' ||
        row.type === 'approval' || row.type === 'session' || row.type === 'attachment' || row.type === 'preview'
      if (standalone) {
        currentAgent.standaloneRows.push(row)
      } else {
        // Merge: tool_result replaces the first unmatched tool_call (same toolName).
        // Using FIFO (findIndex of first unmatched) instead of findLastIndex
        // so that multiple calls to the same tool pair correctly with their results
        // in order: result-1 matches call-1, result-2 matches call-2, etc.
        if (row.type === 'tool' && row.isResult) {
          const matchIdx = currentAgent.rows.findIndex(r => r.type === 'tool' && r.toolName === row.toolName && !r.isResult)
          if (matchIdx >= 0) {
            // Preserve the original id for React key stability; update status+content
            const matched = currentAgent.rows[matchIdx]
            if (matched) {
              currentAgent.rows[matchIdx] = { ...row, id: matched.id }
            }
          } else {
            currentAgent.rows.push(row)
          }
        } else {
          currentAgent.rows.push(row)
        }
      }
    }
  }

  if (currentAgent) items.push(currentAgent)
  return items
}
