import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { TranscriptItem, TranscriptAgentItem, TranscriptUserItem, BlockActionCallback } from '../transcript-item'
import { UserMessage } from './UserMessage'
import { AgentGroup } from './AgentGroup'
import { DateDivider } from './DateDivider'
import './Transcript.css'

const AUTO_FOLLOW_THRESHOLD_PX = 96

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
  /**
   * Optional render slot rendered immediately below each user message.
   * Used by #1406 Phase 3 to mount the inline delegation card below a
   * dispatch-triggering user message. Returns null/undefined when no
   * footer is needed for that item.
   */
  renderUserFooter?: (item: TranscriptUserItem) => React.ReactNode
}

function isUser(item: TranscriptItem): item is Extract<TranscriptItem, { type: 'user' }> {
  return 'type' in item && item.type === 'user'
}

function itemIdentity(item: TranscriptItem): string {
  if (isUser(item)) return `u:${item.id ?? item.name ?? ''}:${item.text}`
  if (isAgent(item)) {
    const parts = item.parts?.map((part) => (
      part.type === 'bubble'
        ? `b:${part.text.length}:${part.text.slice(-24)}`
        : `r:${part.row.id}:${part.row.status}:${part.row.content ?? ''}`
    )).join('|') ?? ''
    return `a:${item.id}:${item.rows.length}:${item.standaloneRows.length}:${item.bubbles.join('').length}:${parts}`
  }
  return ''
}

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_FOLLOW_THRESHOLD_PX
}

function scrollToBottom(element: HTMLElement): void {
  const previousScrollBehavior = element.style.scrollBehavior
  element.style.scrollBehavior = 'auto'
  element.scrollTop = element.scrollHeight
  element.style.scrollBehavior = previousScrollBehavior
}

function containsNewUserMessage(
  items: TranscriptItem[],
  currentIdentities: string[],
  previousIdentities: string[],
): boolean {
  return items.some((item, index) => (
    isUser(item) && currentIdentities[index] !== previousIdentities[index]
  ))
}

function isAgent(item: TranscriptItem): item is TranscriptAgentItem {
  return !isUser(item)
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

export const Transcript = memo(function Transcript({ items, chatMode, onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds, renderUserFooter }: Props) {
  const segments = useMemo(() => partitionWithDates(items), [items])
  const transcriptRef = useRef<HTMLDivElement>(null)
  const shouldAutoFollowRef = useRef(true)
  const previousCountRef = useRef(0)
  const previousIdentitiesRef = useRef<string[]>([])
  const followAfterUserSubmitRef = useRef(false)
  const itemsIdentity = useMemo(() => items.map(itemIdentity).join('\n'), [items])

  const handleScroll = useCallback(() => {
    const element = transcriptRef.current
    if (!element) return
    const nearBottom = isNearBottom(element)
    shouldAutoFollowRef.current = nearBottom
    if (!nearBottom) followAfterUserSubmitRef.current = false
  }, [])

  useLayoutEffect(() => {
    const element = transcriptRef.current
    if (!element) return undefined
    const currentIdentities = items.map(itemIdentity)
    const appendedUserMessage = containsNewUserMessage(items, currentIdentities, previousIdentitiesRef.current)
    const initialRender = previousCountRef.current === 0
    if (appendedUserMessage) followAfterUserSubmitRef.current = true

    const shouldFollow = initialRender || followAfterUserSubmitRef.current || shouldAutoFollowRef.current
    previousCountRef.current = items.length
    previousIdentitiesRef.current = currentIdentities
    if (!shouldFollow) return undefined

    const rafs: number[] = []
    rafs.push(requestAnimationFrame(() => {
      scrollToBottom(element)
      rafs.push(requestAnimationFrame(() => scrollToBottom(element)))
    }))
    return () => rafs.forEach((raf) => cancelAnimationFrame(raf))
  }, [items.length, itemsIdentity, items])

  return (
    <div className="transcript" role="log" aria-live="polite" onScroll={handleScroll} ref={transcriptRef}>
      {segments.map((seg) => {
        if (seg.kind === 'divider') return <DateDivider key={seg.key} date={seg.date} />

        const item = seg.item
        if (isUser(item)) {
          const userKey = item.id ?? item.text + (item.name || '')
          const footer = renderUserFooter?.(item)
          return (
            <Fragment key={userKey}>
              <UserMessage item={item} chatMode={chatMode} />
              {footer ?? null}
            </Fragment>
          )
        }
        if (isAgent(item)) return <AgentGroup key={item.id} item={item} chatMode={chatMode} {...(onAgentClick ? { onAgentClick } : {})} {...(onBlockContextMenu ? { onBlockContextMenu } : {})} {...(onBlockSelect ? { onBlockSelect } : {})} {...(onBlockAction ? { onBlockAction } : {})} {...(onReviewFile ? { onReviewFile } : {})} {...(onDeploySubmit ? { onDeploySubmit } : {})} {...(selectedBlockIds ? { selectedBlockIds } : {})} {...(selectionMode !== undefined ? { selectionMode } : {})} {...(softHiddenBlockIds ? { softHiddenBlockIds } : {})} {...(actionedBlockIds ? { actionedBlockIds } : {})} />
        return null
      })}
    </div>
  )
})
