import type { TranscriptAgentItem, TranscriptItem } from '../transcript-item'
import type { RowItem } from '../types'

/**
 * Recursive running-row detection, shared by Transcript (aria-busy / live
 * region, #11) and AgentGroup (streaming-caret class, #1825).
 * `status: 'running'` — the adapter maps every non-completed agent group to
 * it, so a streaming reply always surfaces here.
 */
export function isRowStreaming(row: RowItem): boolean {
  if (row.status === 'running') return true
  if (row.children?.some(isRowStreaming)) return true
  return row.orchAgents?.some((a) => a.status === 'running') ?? false
}

/** True while any row of an agent item is streaming — including nested child
 *  rows and ordered-part rows, mirroring Transcript's streaming view. */
export function isAgentItemStreaming(item: TranscriptAgentItem): boolean {
  if (item.rows.some(isRowStreaming) || item.standaloneRows.some(isRowStreaming)) return true
  return item.parts?.some((part) => part.type === 'row' && isRowStreaming(part.row)) ?? false
}

/** True while any agent item in the list is streaming. */
export function isStreamingItems(items: TranscriptItem[]): boolean {
  return items.some((item) => {
    if ('type' in item) return false // user items carry a `type` discriminant
    return isAgentItemStreaming(item)
  })
}
