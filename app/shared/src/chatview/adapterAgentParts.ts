/**
 * Chatview adapter agent-item mutation helpers.
 * Peel companion of adapter (#1143). Pure only; zero behavior change.
 */

import type { TranscriptBlock, TextTranscriptBlock } from '../transcript/types'
import type { RowItem } from './types'
import type { TranscriptAgentItem } from './transcript-item'

/**
 * Extract evidence refs from a block into the simplified form used by
 * TranscriptAgentItem.evidenceRefs.
 */
export function mapEvidenceRefs(b: TranscriptBlock): TranscriptAgentItem['evidenceRefs'] | undefined {
  if (!b.evidenceRefs || b.evidenceRefs.length === 0) return undefined
  return b.evidenceRefs
}

export function pushAgentRow(agent: TranscriptAgentItem, row: RowItem, standalone: boolean): void {
  if (standalone) {
    agent.standaloneRows.push(row)
  } else {
    agent.rows.push(row)
  }
  agent.parts ??= []
  agent.parts.push({ type: 'row', row })
}

export function pushAgentBubble(agent: TranscriptAgentItem, block: TextTranscriptBlock): void {
  const text = block.text
  agent.bubbles.push(text)
  agent.parts ??= []
  agent.parts.push({
    type: 'bubble',
    text,
    // #1821: carry the upstream block id so the rendered bubble gets the same
    // selectable/context-menu identity (`data-selectable-card`) tool rows have.
    ...(block.id ? { blockId: block.id } : {}),
    ...(block.displayTitle ? { displayTitle: block.displayTitle } : {}),
    ...(block.displayDetail ? { displayDetail: block.displayDetail } : {}),
    ...(block.badgeLabel ? { badgeLabel: block.badgeLabel } : {}),
    ...(block.badgeVariant ? { badgeVariant: block.badgeVariant } : {}),
  })
}

export function replaceAgentRow(agent: TranscriptAgentItem, id: string, row: RowItem): void {
  const replaceById = (rows: RowItem[]) => {
    const index = rows.findIndex((item) => item.id === id)
    if (index >= 0) rows[index] = row
  }
  replaceById(agent.rows)
  replaceById(agent.standaloneRows)
  if (agent.parts) {
    const partIndex = agent.parts.findIndex((part) => part.type === 'row' && part.row.id === id)
    if (partIndex >= 0) agent.parts[partIndex] = { type: 'row', row }
  }
}
