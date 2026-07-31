import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptItem, TranscriptAgentItem, TranscriptUserItem, BlockActionCallback } from '../transcript-item'
import { ArrowDown } from 'lucide-react'
import { UserMessage } from './UserMessage'
import { AgentGroup } from './AgentGroup'
import { DateDivider } from './DateDivider'
import './Transcript.css'

const AUTO_FOLLOW_THRESHOLD_PX = 96

/** Session key used when no sessionId prop is provided (single-session usage). */
const DEFAULT_SESSION_KEY = '__default__'

/**
 * Scroll memory for one session. The Transcript survives session switches
 * (the consumer swaps `items` instead of unmounting), so all auto-follow
 * state must be isolated per session — otherwise session A's "scrolled up"
 * state force-follows in session B, and B inherits A's physical scrollTop.
 */
interface SessionScrollState {
  /** Last scrollTop observed for this session (tracked on scroll events). */
  scrollTop: number
  /** Whether the user was near the bottom when this session was last shown. */
  shouldAutoFollow: boolean
  /** True right after the user submits a message — forces follow even from older content. */
  followAfterUserSubmit: boolean
  /** items.length of the last applied render — 0 marks a never-rendered session. */
  previousCount: number
  /** itemIdentity baselines of the last applied render (same-session append detection). */
  previousIdentities: string[]
  /** Whether the scroll-to-bottom button should be visible. */
  nearBottom: boolean
}

function createSessionScrollState(): SessionScrollState {
  return {
    scrollTop: 0,
    shouldAutoFollow: true,
    followAfterUserSubmit: false,
    previousCount: 0,
    previousIdentities: [],
    nearBottom: true,
  }
}

interface Props {
  items: TranscriptItem[]
  chatMode: 'dm' | 'group'
  /**
   * Identity of the conversation/session this transcript belongs to.
   * The Transcript is NOT unmounted when the active session changes (the
   * consumer swaps the items prop instead), so scroll memory — auto-follow
   * state, scroll position, the "new user message" baseline — is isolated
   * per sessionId: switching sessions neither force-scrolls to the bottom
   * nor leaks one session's scroll position into another. Omit when the
   * transcript always belongs to a single session.
   */
  sessionId?: string
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

export const Transcript = memo(function Transcript({ items, sessionId, chatMode, onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds, renderUserFooter }: Props) {
  const segments = useMemo(() => partitionWithDates(items), [items])
  const transcriptRef = useRef<HTMLDivElement>(null)
  /** Scroll state per session — see SessionScrollState. */
  const sessionStatesRef = useRef(new Map<string, SessionScrollState>())
  /** Session key currently rendered; updated in the layout effect. */
  const currentSessionRef = useRef<string | null>(null)
  /** Pointer to the active session's state (read by handleScroll). */
  const currentStateRef = useRef<SessionScrollState | null>(null)
  const itemsIdentity = useMemo(() => items.map(itemIdentity).join('\n'), [items])
  const [nearBottom, setNearBottom] = useState(true)

  const handleScroll = useCallback(() => {
    const element = transcriptRef.current
    if (!element) return
    const nb = isNearBottom(element)
    setNearBottom(nb)
    const state = currentStateRef.current
    if (state) {
      state.nearBottom = nb
      state.scrollTop = element.scrollTop
      state.shouldAutoFollow = nb
      if (!nb) state.followAfterUserSubmit = false
    }
  }, [])

  useLayoutEffect(() => {
    const element = transcriptRef.current
    if (!element) return undefined
    const sessionKey = sessionId ?? DEFAULT_SESSION_KEY
    const switched = currentSessionRef.current !== sessionKey

    let state = sessionStatesRef.current.get(sessionKey)
    if (switched) {
      // Leaving the previous session. The DOM at this point already contains
      // the incoming session's content, so element.scrollTop may have been
      // clamped to the new content — prefer the position tracked by onScroll
      // for sessions the user had scrolled away from the bottom of.
      const prevKey = currentSessionRef.current
      if (prevKey !== null) {
        const prev = sessionStatesRef.current.get(prevKey)
        if (prev && !prev.shouldAutoFollow) {
          prev.scrollTop = Math.max(prev.scrollTop, element.scrollTop)
        }
      }
      if (!state) {
        state = createSessionScrollState()
        sessionStatesRef.current.set(sessionKey, state)
      }
      currentSessionRef.current = sessionKey
      currentStateRef.current = state
      // Restore this session's own scroll position (clamped to what the
      // incoming content allows) instead of the outgoing session's.
      element.scrollTop = Math.min(state.scrollTop, Math.max(0, element.scrollHeight - element.clientHeight))
      setNearBottom(state.nearBottom)
    }
    // State is guaranteed to exist from here on (created on the first switch).
    if (!state) return undefined

    const currentIdentities = items.map(itemIdentity)
    // A session switch is NOT a new user message — only same-session appends
    // (e.g. the user submitting a message) force a follow. Identity baselines
    // are per-session, so switching never misjudges the new items.
    const appendedUserMessage = !switched && containsNewUserMessage(items, currentIdentities, state.previousIdentities)
    const initialRender = state.previousCount === 0
    if (appendedUserMessage) state.followAfterUserSubmit = true

    const shouldFollow = initialRender || state.followAfterUserSubmit || state.shouldAutoFollow
    state.previousCount = items.length
    state.previousIdentities = currentIdentities
    if (!shouldFollow) return undefined

    const rafs: number[] = []
    rafs.push(requestAnimationFrame(() => {
      scrollToBottom(element)
      rafs.push(requestAnimationFrame(() => scrollToBottom(element)))
    }))
    return () => rafs.forEach((raf) => cancelAnimationFrame(raf))
  }, [items.length, itemsIdentity, items, sessionId])

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
      {/* Scroll-to-bottom button — appears when user has scrolled up */}
      {!nearBottom && (
        <button
          className="scroll-to-bottom-btn"
          onClick={() => scrollToBottom(transcriptRef.current!)}
          aria-label="回到底部"
          type="button"
        >
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  )
})
