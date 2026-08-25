/**
 * Chatview adapter public surface — TranscriptBlock[] → TranscriptItem[].
 * Residual pure-helper peel of adapter (#1143). Pure only; zero behavior change.
 *
 * Implementations live in companions (adapterShared / adapterMapBlock /
 * adapterAgentParts); this file keeps the public orchestrator so consumers
 * importing from `./adapter` remain stable.
 */

import type {
  TranscriptBlock,
  TextTranscriptBlock,
  AgentTimelineTranscriptBlock,
  RunStepGroupTranscriptBlock,
  CompactBoundaryTranscriptBlock,
} from '../transcript/types'
import type { RowItem } from './types'
import type { TranscriptItem, TranscriptAgentItem } from './transcript-item'
import { SEP, pickDisplay, newAgentBlock, timeStr } from './adapterShared'
import { mapBlock } from './adapterMapBlock'
import {
  mapEvidenceRefs,
  pushAgentRow,
  pushAgentBubble,
  replaceAgentRow,
} from './adapterAgentParts'

// Re-export for consumers
export type { TranscriptBlock }
export { SEP }

/**
 * Convert an array of upstream TranscriptBlock objects into
 * generic TranscriptItem objects ready for rendering.
 *
 * This is the primary integration point for ChatView. Upstream data sources
 * produce `TranscriptBlock[]`, call this function, and feed the resulting
 * `TranscriptItem[]` to the Transcript component.
 *
 * Grouping rules:
 * - Consecutive blocks with the same `author.id` are merged into one
 *   TranscriptAgentItem.
 * - User text blocks (`role === 'human'`, `kind === 'text'`) produce
 *   TranscriptUserItem entries.
 * - User attachment blocks (`role === 'human'`, `kind === 'attachment'`)
 *   produce TranscriptUserItem entries carrying the attachment row (#1957),
 *   closing the send-image → see-image loop for the sender's own uploads.
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

    // ── User text or attachment (#1957) ──
    if (role === 'human' && (block.kind === 'text' || block.kind === 'attachment')) {
      if (currentAgent) { items.push(currentAgent); currentAgent = null }
      if (block.kind === 'attachment') {
        const row = mapBlock(block)
        if (row) {
          items.push({
            type: 'user', id: block.id, name: block.author?.name, time: timeStr(block.createdAt), text: '',
            attachments: [row],
          })
        }
        continue
      }
      const t = block as TextTranscriptBlock
      items.push({
        type: 'user', id: block.id, name: block.author?.name, time: timeStr(block.createdAt), text: t.text,
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
      if (t.text) pushAgentBubble(agent, t)
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
          pushAgentRow(currentAgent, row, false)
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
          ...(g.meta !== undefined ? { extra: g.meta } : {}),
        }
        pushAgentRow(currentAgent, groupRow, false)
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
        currentAgent = { id: block.author?.id ?? 'unknown', agent: block.author?.name || 'Agent', role, time: timeStr(block.createdAt), rows: [], bubbles: [], standaloneRows: [], parts: [], runs: [], groupId, ...(refs ? { evidenceRefs: refs } : {}) }
        currentAgent.id = `${block.author?.id ?? 'unknown'}-${_seq}`
      }
      if (!currentAgent) continue
      // Standalone cards vs inline rows
      const standalone = row.type === 'route' || row.type === 'deploy' || row.type === 'ctx' ||
        row.type === 'approval' || row.type === 'session' || row.type === 'attachment' || row.type === 'preview'
      // Merge: tool_result replaces the first unmatched tool_call (same toolName).
      // Using FIFO (findIndex of first unmatched) instead of findLastIndex
      // so that multiple calls to the same tool pair correctly with their results
      // in order: result-1 matches call-1, result-2 matches call-2, etc.
      if (row.type === 'tool' && row.isResult) {
        const matchIdx = currentAgent.rows.findIndex(r => (
          r.type === 'tool' &&
          !r.isResult &&
          (row.toolCallId && r.toolCallId
            ? r.toolCallId === row.toolCallId
            : r.toolName === row.toolName)
        ))
        if (matchIdx >= 0) {
          // Preserve the original id for React key stability; update status+content
          const matched = currentAgent.rows[matchIdx]
          if (matched) {
            replaceAgentRow(currentAgent, matched.id, { ...row, id: matched.id })
          }
        } else {
          pushAgentRow(currentAgent, row, false)
        }
      } else {
        pushAgentRow(currentAgent, row, standalone)
      }
    }
  }

  if (currentAgent) items.push(currentAgent)
  return items
}

/**
 * Resolve the transcript item index before which an unread-messages divider
 * should render (desktop IM path, T8).
 *
 * The consumer (session model) maps the read watermark (last_read_seq) to the
 * transcript block id of the first unread message. This helper converts that
 * block-level anchor to an ITEM-level index, because blocks and items are not
 * 1:1 — consecutive same-author agent blocks merge into one TranscriptAgentItem
 * and some blocks are dropped (human non-text blocks other than attachments,
 * which start their own user items since #1957).
 *
 * Placement rules:
 * - Exact: the anchor block's containing item (the item whose render starts at
 *   or before the anchor block). Mirrors the adapter's grouping so merged
 *   agent groups are treated as a unit.
 * - Fallback: when the anchor block is not present in the filtered blocks
 *   (e.g. it was dropped upstream), place by the unread tail count.
 * - No descriptor / zero count / empty items → -1 (render nothing).
 */
export function resolveUnreadAnchorItemIndex(
  blocks: TranscriptBlock[],
  items: TranscriptItem[],
  descriptor: { anchorBlockId?: string; count: number } | undefined,
): number {
  if (!descriptor || descriptor.count <= 0 || items.length === 0) return -1

  const anchorIndex = descriptor.anchorBlockId
    ? blocks.findIndex((b) => b.id === descriptor.anchorBlockId)
    : -1
  if (anchorIndex < 0) {
    // Anchor block filtered out upstream — approximate with the unread tail.
    return Math.max(0, items.length - descriptor.count)
  }

  // Count item starts (adapter grouping) up to and including the anchor block.
  let starts = 0
  let prevAgentAuthor: string | null = null
  for (let i = 0; i <= anchorIndex; i++) {
    const block = blocks[i]
    if (!block) continue
    const role = block.author?.role ?? 'system'
    const author = block.author?.id ?? 'unknown'
    if (role === 'human' && (block.kind === 'text' || block.kind === 'attachment')) {
      // Human attachment blocks start their own user item (#1957), exactly
      // like human text blocks.
      starts++
      prevAgentAuthor = null
    } else if (role === 'agent' || role === 'system') {
      // Consecutive same-author agent blocks merge into one group.
      if (author !== prevAgentAuthor) starts++
      prevAgentAuthor = author
    }
    // Remaining human non-text blocks are dropped by the adapter — they start nothing.
  }
  return Math.max(0, starts - 1)
}

/**
 * Compact divider descriptor produced by `resolveCompactDividerIndices`.
 * Each entry marks the TranscriptItem index before which a compact_boundary
 * divider should render, plus optional metadata for the divider label.
 */
export interface CompactDividerDescriptor {
  /** Item index before which the compact divider renders. */
  index: number
  /** Compaction trigger, e.g. "auto" or "manual". */
  trigger?: string
  /** Token count before compaction. */
  preTokens?: number
}

/**
 * Compute compact boundary divider positions for a transcript.
 *
 * Compact boundary blocks (`kind: 'compact_boundary'`) are stream-internal
 * markers emitted when the model compacts its context mid-run. They are not
 * conversational content and should render as thin dividers between message
 * groups, similar to UnreadDivider and DateDivider.
 *
 * This function simulates the same block-to-item grouping that
 * `blocksToTranscriptItems` performs, so the returned indices reference
 * positions in the adapted items array, not the raw blocks array.
 *
 * @param blocks - Raw transcript blocks (including compact_boundary blocks).
 * @returns Sorted array of compact divider descriptors (by ascending index).
 */
export function resolveCompactDividerIndices(blocks: TranscriptBlock[]): CompactDividerDescriptor[] {
  const result: CompactDividerDescriptor[] = []
  let itemIdx = 0
  let prevAgentAuthor: string | null = null

  for (const block of blocks) {
    if (block.kind === 'compact_boundary') {
      const cb = block as CompactBoundaryTranscriptBlock
      result.push({
        index: itemIdx,
        ...(cb.trigger ? { trigger: cb.trigger } : {}),
        ...(cb.preTokens != null ? { preTokens: cb.preTokens } : {}),
      })
      continue
    }

    const role = block.author?.role ?? 'system'
    const author = block.author?.id ?? 'unknown'

    // Mirror the adapter grouping: user text, user attachment (#1957) and
    // agent/system blocks increment the item counter; compact_boundary and
    // remaining human non-text blocks do not.
    if (role === 'human' && (block.kind === 'text' || block.kind === 'attachment')) {
      itemIdx++
      prevAgentAuthor = null
    } else if (role === 'agent' || role === 'system') {
      // Consecutive same-author agent blocks merge into one group.
      if (author !== prevAgentAuthor) itemIdx++
      prevAgentAuthor = author
    }
    // Remaining human non-text, compact_boundary, and other edge cases are already handled above.
  }

  return result
}
