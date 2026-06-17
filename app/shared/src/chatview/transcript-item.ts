/* ═══════════════════════════════════════════════════════════════════════
   TRANSCRIPT ITEM TYPES
   Generic types used by Transcript component. No upstream dependency.
   ══════════════════════════════════════════════════════════════════════ */

import type { RowItem } from './types'

/** A user message rendered in the transcript. */
export interface TranscriptUserItem {
  type: 'user'
  name?: string
  time?: string
  text: string
  displayTitle?: string
  badgeLabel?: string
  badgeVariant?: 'thinking' | 'success' | 'warning' | 'danger' | 'primary'
}

/** An agent block rendered in the transcript — groups rows, bubbles, standalone cards. */
export interface TranscriptAgentItem {
  id: string
  agent: string
  role: string
  time: string
  rows: RowItem[]
  bubbles: string[]
  standaloneRows: RowItem[]
  runs: never[]
  groupId?: string
  displayTitle?: string
  badgeLabel?: string
  badgeVariant?: 'thinking' | 'success' | 'warning' | 'danger' | 'primary'
}

/** Union type of items Transcript can render. */
export type TranscriptItem = TranscriptUserItem | TranscriptAgentItem
