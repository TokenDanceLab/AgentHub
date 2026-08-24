import { Fragment, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptItem, TranscriptAgentItem, TranscriptUserItem, BlockActionCallback } from '../transcript-item'
import { ArrowDown } from 'lucide-react'
import { Virtualizer, type VirtualizerHandle } from 'virtua'
import { UserMessage } from './UserMessage'
import { AgentGroup } from './AgentGroup'
import { DateDivider } from './DateDivider'
import { UnreadDivider } from './UnreadDivider'
import { CompactDivider } from './CompactDivider'
import { stableInteractionId } from './RowItem'
import { isStreamingItems } from './streaming'
import { useTranslation, getI18n } from 'react-i18next'
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources'
import { appDateLocaleTag } from '../../i18n/locale'
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
  previewExternalOpenEnabled?: boolean
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
  /**
   * Unread-messages divider (T8 desktop IM path): item index before which
   * the divider renders, plus pre-resolved copy. Absent for non-IM transcripts.
   */
  unreadDivider?: { index: number; label: string; readThrough?: string } | undefined
  /**
   * Compact boundary dividers (T21/CF23): item indices before which compact
   * dividers render, with optional trigger and pre-token metadata.
   */
  compactDividers?: { index: number; trigger?: string; preTokens?: number }[] | undefined
}

/**
 * Imperative handle exposed by the Transcript so the parent
 * (ChatViewTranscript) can drive the virtualizer for highlight/search jumps.
 * Under virtualization the target row may be off-screen and unmounted, so the
 * parent first asks the Transcript to scroll the containing segment into view
 * via {@link scrollToBlockId}, then querySelector-s the now-mounted row to add
 * the highlight class (existing interaction preserved, RFC §6.3).
 */
export interface TranscriptHandle {
  /**
   * Scroll the virtualizer so the segment containing `blockId` is mounted.
   * Returns the segment index, or `-1` if no segment contains the block
   * (caller falls back to a plain querySelector).
   */
  scrollToBlockId(blockId: string): number
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
  return parsed.toLocaleDateString(appDateLocaleTag(getI18n()?.language), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** A segment of the transcript: a date divider, the unread divider, a compact divider, or a transcript item. */
type TranscriptSegment =
  | { kind: 'divider'; date: string; key: string }
  | { kind: 'unread'; label: string; readThrough?: string }
  | { kind: 'compact_divider'; trigger?: string; preTokens?: number; key: string }
  | { kind: 'item'; item: TranscriptItem }

/**
 * Partition items into segments with date dividers inserted at day boundaries.
 * A divider is inserted before the first item whose day differs from the previous item.
 * The unread divider (desktop IM read watermark) is inserted before the item
 * at `unreadDivider.index` (already resolved against the adapted items).
 * Compact dividers are inserted before items at their respective indices.
 */
function partitionWithDates(
  items: TranscriptItem[],
  unreadDivider: { index: number; label: string; readThrough?: string } | undefined,
  compactDividers: { index: number; trigger?: string; preTokens?: number }[] | undefined,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []

  // Index compact dividers by their target item index for O(1) lookup.
  // Multiple compact dividers at the same index are stacked in order.
  const compactByIndex = new Map<number, { trigger?: string; preTokens?: number }[]>()
  if (compactDividers && compactDividers.length > 0) {
    for (const cd of compactDividers) {
      const list = compactByIndex.get(cd.index)
      const divider = {
        ...(cd.trigger !== undefined ? { trigger: cd.trigger } : {}),
        ...(cd.preTokens !== undefined ? { preTokens: cd.preTokens } : {}),
      }
      if (list) {
        list.push(divider)
      } else {
        compactByIndex.set(cd.index, [divider])
      }
    }
  }

  let prevDay: string | null = null

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue

    // Insert compact dividers before the item at this index
    const cds = compactByIndex.get(i)
    if (cds) {
      for (let ci = 0; ci < cds.length; ci++) {
        const cd = cds[ci]
        segments.push({
          kind: 'compact_divider',
          key: `compact-${i}-${ci}`,
          ...(cd?.trigger ? { trigger: cd.trigger } : {}),
          ...(cd?.preTokens != null ? { preTokens: cd.preTokens } : {}),
        })
      }
    }

    if (unreadDivider && i === unreadDivider.index) {
      segments.push({
        kind: 'unread',
        label: unreadDivider.label,
        ...(unreadDivider.readThrough ? { readThrough: unreadDivider.readThrough } : {}),
      })
    }
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

/**
 * Build a `blockId → segmentIndex` map for virtualized highlight/search jumps.
 * Only row interaction ids (the value carried by `data-block-id` on RowItem)
 * are mapped — those are the highlightable targets. Text bubbles (user
 * messages and agent bubbles, #1821) also carry `data-block-id` but are not
 * indexed here: their highlight resolves to -1 and falls back to the plain
 * querySelector, which finds them when mounted. Rows come from an agent
 * item's `rows`, `standaloneRows`, and the row parts interleaved with bubbles
 * in `parts` (RFC §6.3 / §8.1).
 */
function buildBlockIndexMap(segments: TranscriptSegment[]): Map<string, number> {
  const map = new Map<string, number>()
  segments.forEach((seg, i) => {
    if (seg.kind !== 'item') return
    const item = seg.item
    if (isAgent(item)) {
      for (const row of item.rows) map.set(stableInteractionId(row), i)
      for (const row of item.standaloneRows) map.set(stableInteractionId(row), i)
      if (item.parts) {
        for (const part of item.parts) {
          if (part.type === 'row') map.set(stableInteractionId(part.row), i)
        }
      }
    }
  })
  return map
}

const TranscriptImpl = forwardRef<TranscriptHandle, Props>(function Transcript({ items, sessionId, chatMode, onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit, previewExternalOpenEnabled, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds, renderUserFooter, unreadDivider, compactDividers }: Props, ref) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE)
  const segments = useMemo(() => partitionWithDates(items, unreadDivider, compactDividers), [items, unreadDivider, compactDividers])
  /**
   * Streaming throttle for the role=log live region (#11). While any row is
   * still running, token-by-token DOM mutation would make ATs re-announce
   * the full transcript text on every tick.
   */
  const isStreaming = useMemo(() => isStreamingItems(items), [items])
  const transcriptRef = useRef<HTMLDivElement>(null)
  /** Virtualizer handle — used for highlight/search scrollToIndex jumps. */
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  /** blockId → segment index, for virtualized highlight/search jumps (RFC §6.3). */
  const blockIndexMap = useMemo(() => buildBlockIndexMap(segments), [segments])
  /** Scroll state per session — see SessionScrollState. */
  const sessionStatesRef = useRef(new Map<string, SessionScrollState>())
  /** Session key currently rendered; updated in the layout effect. */
  const currentSessionRef = useRef<string | null>(null)
  /** Pointer to the active session's state (read by handleScroll). */
  const currentStateRef = useRef<SessionScrollState | null>(null)
  const itemsIdentity = useMemo(() => items.map(itemIdentity).join('\n'), [items])
  const [nearBottom, setNearBottom] = useState(true)
  /** #1825: identity of the newest same-session message, keyed for a one-shot
   *  entry animation. Cleared after the animation window so virtualized
   *  remounts (scrolling history) never replay it. */
  const [arrivalKey, setArrivalKey] = useState<string | null>(null)
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current)
  }, [])

  const arrivalIdOf = (item: TranscriptItem): string =>
    isUser(item) ? (item.id ?? `${item.text}|${item.name ?? ''}`) : item.id

  useImperativeHandle(ref, () => ({
    scrollToBlockId(blockId: string) {
      const idx = blockIndexMap.get(blockId)
      if (idx === undefined) return -1
      // Instant center-mount of the containing segment; the caller follows up
      // with a rAF + querySelector + scrollIntoView for the smooth final
      // centering and highlight class (RFC §6.3). Smooth here would fight the
      // subsequent scrollIntoView and is avoided per virtua guidance.
      virtualizerRef.current?.scrollToIndex(idx, { align: 'center' })
      return idx
    },
  }), [blockIndexMap])

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

    // #1825: new-message entry animation — only for genuine appends at the
    // end (previousIdentities is an unchanged prefix of the current list).
    // Prepended history (pagination) grows the list too and must not replay
    // the animation on the existing newest message.
    const appendedAtEnd = currentIdentities.length > state.previousIdentities.length &&
      state.previousIdentities.every((id, i) => currentIdentities[i] === id)
    const lastItem = items[items.length - 1]
    if (!switched && appendedAtEnd && lastItem) {
      const newKey = arrivalIdOf(lastItem)
      setArrivalKey(newKey)
      if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current)
      arrivalTimerRef.current = setTimeout(() => {
        setArrivalKey((k) => (k === newKey ? null : k))
      }, 600)
    }

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
    // A11y (#11): while streaming, `aria-live` drops to 'off' so ATs stay
    // silent through the token torrent and `aria-busy` marks the region as
    // mid-update; when streaming completes the region returns to 'polite'
    // and the accumulated content is announced at most once (SR-dependent).
    // aria-atomic="true" was rejected: on a long transcript every mutation
    // would announce the ENTIRE region text — strictly worse than today.
    <div className="transcript" role="log" aria-live={isStreaming ? 'off' : 'polite'} aria-busy={isStreaming} onScroll={handleScroll} ref={transcriptRef}>
      <Virtualizer ref={virtualizerRef} scrollRef={transcriptRef} bufferSize={800}>
        {segments.map((seg) => {
          if (seg.kind === 'divider') return <DateDivider key={seg.key} date={seg.date} />
          if (seg.kind === 'unread') {
            return <UnreadDivider key="unread-divider" label={seg.label} {...(seg.readThrough ? { readThrough: seg.readThrough } : {})} />
          }
          if (seg.kind === 'compact_divider') {
            return <CompactDivider key={seg.key} trigger={seg.trigger} preTokens={seg.preTokens} />
          }

          const item = seg.item
          if (isUser(item)) {
            /* #1825: derive the key from arrivalIdOf so the entry-animation
               comparison can never drift from the React key. */
            const userKey = arrivalIdOf(item)
            const footer = renderUserFooter?.(item)
            return (
              <Fragment key={userKey}>
                <UserMessage item={item} chatMode={chatMode} enter={arrivalKey === userKey} {...(onBlockContextMenu ? { onContextMenu: onBlockContextMenu } : {})} />
                {footer ?? null}
              </Fragment>
            )
          }
          if (isAgent(item)) return <AgentGroup key={item.id} item={item} chatMode={chatMode} enter={arrivalKey === item.id} {...(onAgentClick ? { onAgentClick } : {})} {...(onBlockContextMenu ? { onBlockContextMenu } : {})} {...(onBlockSelect ? { onBlockSelect } : {})} {...(onBlockAction ? { onBlockAction } : {})} {...(onReviewFile ? { onReviewFile } : {})} {...(onDeploySubmit ? { onDeploySubmit } : {})} {...(previewExternalOpenEnabled !== undefined ? { previewExternalOpenEnabled } : {})} {...(selectedBlockIds ? { selectedBlockIds } : {})} {...(selectionMode !== undefined ? { selectionMode } : {})} {...(softHiddenBlockIds ? { softHiddenBlockIds } : {})} {...(actionedBlockIds ? { actionedBlockIds } : {})} />
          return null
        })}
      </Virtualizer>
      {/* Scroll-to-bottom button — appears when user has scrolled up */}
      {!nearBottom && (
        <button type="button"
          className="scroll-to-bottom-btn"
          onClick={() => scrollToBottom(transcriptRef.current!)}
          aria-label={t("aria.scrollToBottom")}
        >
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  )
})

export const Transcript = memo(TranscriptImpl)
