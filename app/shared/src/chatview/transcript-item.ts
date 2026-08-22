/* ═══════════════════════════════════════════════════════════════════════
   TRANSCRIPT ITEM TYPES
   Generic types used by Transcript component. No upstream dependency.
   ══════════════════════════════════════════════════════════════════════ */

import type { RowItem } from './types'
import type { BadgeVariant, EvidenceRef } from '../transcript/types'

/** A user message rendered in the transcript. */
export interface TranscriptUserItem {
  type: 'user'
  id?: string
  name?: string
  time?: string
  text: string
  displayTitle?: string
  displayDetail?: string
  badgeLabel?: string
  badgeVariant?: BadgeVariant
}

export type TranscriptAgentPart =
  | { type: 'row'; row: RowItem }
  | {
      type: 'bubble'
      text: string
      /**
       * Upstream text block id (#1821): the selectable/context-menu identity
       * of this bubble, matching the `data-selectable-card` semantics tool
       * rows carry via `stableInteractionId`. Absent for synthetic bubbles
       * built without an upstream block.
       */
      blockId?: string
      displayTitle?: string
      displayDetail?: string
      badgeLabel?: string
      badgeVariant?: BadgeVariant
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
  parts?: TranscriptAgentPart[]
  runs: never[]
  groupId?: string
  displayTitle?: string
  displayDetail?: string
  badgeLabel?: string
  badgeVariant?: BadgeVariant
  /** ID of the upstream block this message is replying to. */
  replyBlockId?: string
  /** Author name of the replied message. */
  replyAuthor?: string
  /** Short preview of the replied message content. */
  replyPreview?: string
  /** Evidence references collected from the block's evidenceRefs. */
  evidenceRefs?: EvidenceRef[]
}

/** Union type of items Transcript can render. */
export type TranscriptItem = TranscriptUserItem | TranscriptAgentItem

/** Generic action callback from Transcript to consumer.
 *  Actions: 'copy', 'regenerate', 'pin', 'reply', 'quote', 'link', 'delete'.
 *  Metadata carries action-specific payload (e.g. selected text for copy). */
export type BlockActionCallback = (
  action: string,
  blockId: string,
  metadata?: Record<string, unknown>,
) => void
