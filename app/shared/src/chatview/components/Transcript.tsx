import { memo, useMemo } from 'react'
import type { TranscriptItem, BlockActionCallback } from '../transcript-item'
import { UserMessage } from './UserMessage'
import { AgentGroup } from './AgentGroup'
import { DateDivider } from './DateDivider'
import './Transcript.css'

interface Props {
  items: TranscriptItem[]
  chatMode: 'dm' | 'group'
  onAgentClick?: (agentName: string, anchor: HTMLElement) => void
  onBlockContextMenu?: (blockId: string, event: React.MouseEvent) => void
  onBlockSelect?: (blockId: string, shiftKey: boolean) => void
  onBlockAction?: BlockActionCallback
  onReviewFile?: (file: { name: string; path?: string; url?: string; content?: string; language?: string }) => void
  onDeploySubmit?: (id: string) => void
  selectedBlockIds?: Set<string>
  selectionMode?: boolean
  softHiddenBlockIds?: Set<string>
  actionedBlockIds?: Set<string>
}

function isUser(item: TranscriptItem): item is Extract<TranscriptItem, { type: 'user' }> {
  return 'type' in item && item.type === 'user'
}

function isAgent(item: TranscriptItem): item is Extract<TranscriptItem, { id: string }> {
  return 'id' in item
}

/** Extract the item's time string — `time` on both user and agent items. */
function itemTime(item: TranscriptItem): string {
  if (isUser(item)) return item.time || ''
  if (isAgent(item)) return item.time || ''
  return ''
}

/**
 * Returns a locale-aware day key from a time string.
 * Used to detect day boundaries between items.
 * Returns null for unparseable or missing times.
 */
function dayKey(time: string): string | null {
  if (!time) return null
  const parsed = new Date(time)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('en-CA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * Format a time string into a locale-aware date label.
 * Falls back to the raw string on parse failure.
 */
function formatItemDate(time: string): string {
  if (!time) return ''
  const parsed = new Date(time)
  if (Number.isNaN(parsed.getTime())) return time
  return parsed.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** A segment of the transcript: either a date divider or a transcript item. */
type TranscriptSegment = { kind: 'divider'; date: string; key: string } | { kind: 'item'; item: TranscriptItem }

/**
 * Partition items into segments with date dividers inserted at day boundaries.
 * A divider is inserted before the first item whose day differs from the previous item.
 */
function partitionWithDates(items: TranscriptItem[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let prevDay: string | null = null

  for (const item of items) {
    const time = itemTime(item)
    const day = time ? dayKey(time) : null
    // Insert divider when day changes (and we have a valid day)
    if (day && day !== prevDay) {
      segments.push({ kind: 'divider', date: formatItemDate(time), key: `date-${day}` })
    }
    segments.push({ kind: 'item', item })
    prevDay = day
  }

  return segments
}

export const Transcript = memo(function Transcript({ items, chatMode, onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds }: Props) {
  const segments = useMemo(() => partitionWithDates(items), [items])

  return (
    <div className="transcript" role="log" aria-live="polite">
      {segments.map((seg) => {
        if (seg.kind === 'divider') return <DateDivider key={seg.key} date={seg.date} />

        const item = seg.item
        if (isUser(item)) return <UserMessage key={item.text + (item.name || '')} item={item} chatMode={chatMode} />
        if (isAgent(item)) return <AgentGroup key={item.id} item={item} chatMode={chatMode} {...(onAgentClick ? { onAgentClick } : {})} {...(onBlockContextMenu ? { onBlockContextMenu } : {})} {...(onBlockSelect ? { onBlockSelect } : {})} {...(onBlockAction ? { onBlockAction } : {})} {...(onReviewFile ? { onReviewFile } : {})} {...(onDeploySubmit ? { onDeploySubmit } : {})} {...(selectedBlockIds ? { selectedBlockIds } : {})} {...(selectionMode !== undefined ? { selectionMode } : {})} {...(softHiddenBlockIds ? { softHiddenBlockIds } : {})} {...(actionedBlockIds ? { actionedBlockIds } : {})} />
        return null
      })}
    </div>
  )
})
