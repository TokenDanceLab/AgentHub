/* ═══════════════════════════════════════════════════════════════════════
   CHAT VIEW TRANSCRIPT — integration wrapper
   Wraps ChatView component tree. Theme deferred to consumer.
   Uses react-i18next with 'chatview' namespace (provided by consumer's outer I18nextProvider).
   ══════════════════════════════════════════════════════════════════════ */

import { Component, useMemo, useEffect, useRef, useCallback, memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Pin, X } from 'lucide-react'

import { Transcript, type TranscriptHandle } from './Transcript'
import { TypingIndicator } from './TypingIndicator'
import { prefersReducedMotion } from '../design/motion'
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources'
import { EmptyState } from '../../ui/EmptyState'
import { Button } from '../../ui/Button'
import { blocksToTranscriptItems, resolveCompactDividerIndices, resolveUnreadAnchorItemIndex, SEP, type TranscriptBlock } from '../adapter'
import type { RowItem } from '../types'
import type { UnreadDividerDescriptor } from '../types'
import type { BlockActionCallback, TranscriptAgentItem, TranscriptItem, TranscriptUserItem } from '../transcript-item'

// Load ChatView design tokens — scoped to .chatview, no :root pollution
import '../design/tokens.css'

interface Props {
  transcript: TranscriptBlock[]
  /** DM or group mode. Inferred from agent count when not provided. */
  chatMode?: 'dm' | 'group'
  /**
   * Conversation/session identity. Passed through to Transcript so scroll
   * memory (auto-follow state, scroll position) is isolated per session —
   * switching sessions must neither force a scroll-to-bottom nor leak one
   * session's scroll position into another.
   */
  sessionId?: string
  onAgentClick?: ((agentName: string, anchor: HTMLElement) => void) | undefined
  onBlockContextMenu?: ((blockId: string, event: React.MouseEvent) => void) | undefined
  onBlockSelect?: ((blockId: string, shiftKey: boolean) => void) | undefined
  onBlockAction?: BlockActionCallback | undefined
  onReviewFile?: ((file: { name: string; path?: string; url?: string; content?: string; language?: string }) => void) | undefined
  /** Artifact card click (#1992): focuses the matching engineering Preview tab. */
  onArtifactClick?: ((item: import('../types').RowItem) => void) | undefined
  /** Checkpoint timeline card click (#1968): opens the read-only snapshot preview. */
  onCheckpointClick?: ((item: import('../types').RowItem) => void) | undefined
  onDeploySubmit?: ((id: string) => void) | undefined
  previewExternalOpenEnabled?: boolean | undefined
  selectedBlockIds?: Set<string>
  selectionMode?: boolean
  softHiddenBlockIds?: Set<string>
  actionedBlockIds?: Set<string>
  /** Scroll to and highlight the block with this id, then auto-clear after 3s. */
  highlightedBlockId?: string | null | undefined
  /** Called when the highlight animation completes (after ~3s). */
  onHighlightEnd?: (() => void) | undefined
  /** Optional pinned announcement to show at the top of the transcript. */
  pinnedAnnouncement?: {
    title: string
    content: string
    author?: string | undefined
    time?: string | undefined
    onCopy?: (() => void) | undefined
    onDismiss?: (() => void) | undefined
  } | undefined
  /** WebSocket connection status for the rail indicator dot. */
  connectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'error' | undefined
  /**
   * Display names of users currently typing in this session.
   * When non-empty, a typing indicator bar is shown below the transcript.
   */
  typingUserNames?: string[] | undefined
  /**
   * Optional render slot rendered immediately below each user message.
   * Used by #1406 Phase 3 to mount the inline delegation card below a
   * dispatch-triggering user message. Returns null/undefined when no
   * footer is needed for that item.
   */
  renderUserFooter?: (item: TranscriptUserItem) => React.ReactNode
  /**
   * Unread-messages divider descriptor (T8 desktop IM path). The consumer
   * (desktop Hub sessions) derives the anchor block id from the session read
   * watermark; this wrapper resolves it to an item index against the adapted
   * items (merged agent groups are treated as a unit) before passing it down.
   */
  unreadDivider?: UnreadDividerDescriptor | undefined
  /**
   * Transcript items are still loading (#1821) — e.g. a session switch or the
   * first load. When the adapted items are empty, an honest loading state
   * renders instead of the misleading "no messages" empty state.
   */
  transcriptLoading?: boolean | undefined
}

function EmptyTranscriptState({ loading }: { loading?: boolean }) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE)
  // #1821: a loading transcript must not claim "no messages" — session
  // switches and first loads get an honest loading state instead.
  if (loading) {
    return (
      <EmptyState
        title={t('transcript.loading')}
        description={t('empty.generalBlank.desc')}
      />
    )
  }
  return (
    <EmptyState
      title={t('transcript.empty')}
      description={t('empty.generalBlank.desc')}
    />
  )
}

interface ErrorBoundaryProps { children: React.ReactNode }
interface ErrorBoundaryState { hasError: boolean }
class TranscriptErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ChatViewTranscript] Transcript render error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return <div className="chatview-empty">Transcript render error</div>
    }
    return this.props.children
  }
}

function isUserItem(item: TranscriptItem): item is Extract<TranscriptItem, { type: 'user' }> {
  return 'type' in item && item.type === 'user'
}

/**
 * a11y (#1503): collect approval rows still awaiting user action across all
 * agent items — rows, standalone rows, interleaved row parts, and nested
 * children. Only `waiting` approvals are actionable requests; completed or
 * denied ones are status transitions, not arrivals. The adapter mirrors every
 * row into both the rows/standaloneRows arrays AND `parts`, so rows are
 * deduped by id to announce each card exactly once.
 */
function collectWaitingApprovalRows(items: TranscriptItem[]): RowItem[] {
  const waitingRows: RowItem[] = []
  const seenRowIds = new Set<string>()
  const visitRow = (row: RowItem): void => {
    if (seenRowIds.has(row.id)) return
    seenRowIds.add(row.id)
    if (row.type === 'approval' && row.status === 'waiting') waitingRows.push(row)
    if (row.children) row.children.forEach(visitRow)
  }
  for (const item of items) {
    if (isUserItem(item)) continue
    const agentItem: TranscriptAgentItem = item
    agentItem.rows.forEach(visitRow)
    agentItem.standaloneRows.forEach(visitRow)
    if (agentItem.parts) {
      for (const part of agentItem.parts) {
        if (part.type === 'row') visitRow(part.row)
      }
    }
  }
  return waitingRows
}

/**
 * Human-readable tool name for the arrival announcement. Approval rows carry
 * `apReason` as `toolName · risk · reason` (adapterMapBlock), so the first
 * segment is the tool when present; falls back to the row label.
 */
export function approvalToolName(row: RowItem): string {
  const first = row.apReason?.split(SEP)[0]?.trim()
  if (first) return first
  return (row.label || row.toolName || '').trim()
}

/**
 * Visually-hidden styling for the approval-arrival live region (#1503).
 * Kept out of CSS files so the region stays self-contained in this wrapper.
 */
const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
}

/**
 * Drop-in replacement for a transcript view (subset of props).
 * Takes TranscriptBlock[] from the upstream data source and renders via ChatView component tree.
 * i18n resolved via react-i18next (chatview namespace), co-existing with the consumer's root provider.
 */
export const ChatViewTranscript = memo(function ChatViewTranscript({ transcript, sessionId, chatMode = 'group', onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onArtifactClick, onCheckpointClick, onDeploySubmit, previewExternalOpenEnabled, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds, highlightedBlockId, onHighlightEnd, pinnedAnnouncement, typingUserNames, renderUserFooter, unreadDivider, transcriptLoading }: Props) {
  const items = useMemo(() => {
    try {
      return blocksToTranscriptItems(transcript)
    } catch (err) {
      console.error('[ChatViewTranscript] blocksToTranscriptItems failed:', err)
      return []
    }
  }, [transcript])
  // Resolve the block-level anchor to an item index (agent groups merge
  // blocks, so the divider must sit above the containing item, not inside it).
  const resolvedUnreadDivider = useMemo(() => {
    if (!unreadDivider) return undefined
    const index = resolveUnreadAnchorItemIndex(transcript, items, unreadDivider)
    if (index < 0) return undefined
    return {
      index,
      label: unreadDivider.label,
      ...(unreadDivider.readThrough ? { readThrough: unreadDivider.readThrough } : {}),
    }
  }, [transcript, items, unreadDivider])

  // Compute compact boundary divider positions from transcript blocks.
  // Compact boundary blocks are filtered out of items but their positions
  // are resolved to item indices for divider rendering.
  const resolvedCompactDividers = useMemo(
    () => resolveCompactDividerIndices(transcript),
    [transcript],
  )
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE)

  // a11y (#1503): approval-arrival announcements. Waiting approval cards live
  // inside the Transcript's role=log region and are unmounted under
  // virtualization while off-screen, so their arrival would never reach a
  // screen reader. Announce through a live region OUTSIDE the virtualizer;
  // each row id is announced once (ref-set dedup, surviving re-renders).
  const announcedApprovalIdsRef = useRef<Set<string>>(new Set())
  const [approvalAnnouncement, setApprovalAnnouncement] = useState('')
  const waitingApprovalRows = useMemo(() => collectWaitingApprovalRows(items), [items])

  useEffect(() => {
    const freshRows = waitingApprovalRows.filter((row) => !announcedApprovalIdsRef.current.has(row.id))
    if (freshRows.length === 0) return
    for (const row of freshRows) announcedApprovalIdsRef.current.add(row.id)
    const announcement = freshRows
      .map((row) => approvalToolName(row) || t('card.approval.title'))
      .map((tool) => t('a11y.approvalArrived', { tool }))
      .join('；')
    setApprovalAnnouncement(announcement)
  }, [waitingApprovalRows, t])

  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Imperative handle into the virtualized Transcript — used to mount the
   *  segment containing a highlighted block before querySelector-ing it. */
  const transcriptRef = useRef<TranscriptHandle>(null)

  // Memory-stable callback so the effect doesn't re-fire on render churn
  const onHighlightEndRef = useRef(onHighlightEnd)
  onHighlightEndRef.current = onHighlightEnd

  const clearHighlight = useCallback(() => {
    if (!containerRef.current) return
    const el = containerRef.current.querySelector('.row-item.highlighted')
    if (el) el.classList.remove('highlighted')
  }, [])

  useEffect(() => {
    if (!highlightedBlockId || !containerRef.current) return

    // Under virtualization the target row may be off-screen and unmounted.
    // Ask the Transcript to scroll the containing segment into view first;
    // scrollToIndex mounts the segment so the rAF below can find the row.
    // Returns -1 when no segment contains the block — then we still try the
    // querySelector (graceful fallback for ids without a data-block-id, e.g.
    // user messages, preserving pre-virtualization behavior).
    transcriptRef.current?.scrollToBlockId(highlightedBlockId)

    // Wait one tick for the DOM to settle (new rows may be rendering)
    const raf = requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(`[data-block-id="${highlightedBlockId}"]`) as HTMLElement | null
      if (!el) return

      // Remove previous highlight if any
      clearHighlight()

      // #1825: smooth scroll only when the user has not opted out of motion.
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
      el.classList.add('highlighted')

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        el.classList.remove('highlighted')
        timerRef.current = undefined
        onHighlightEndRef.current?.()
      }, 3000)
    })

    return () => {
      cancelAnimationFrame(raf)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [highlightedBlockId, clearHighlight])

  return (
    <div className="chatview" data-pinned={pinnedAnnouncement ? 'true' : 'false'} ref={containerRef}>
      {pinnedAnnouncement && (
        <div className="chatview-pinned-wrap">
          <div className="chatview-pinned-banner">
            <span className="chatview-pinned-mark" aria-hidden="true">
              <Pin size={14} />
            </span>
            <div className="chatview-pinned-copy">
              <div className="chatview-pinned-line">
                <strong>{pinnedAnnouncement.title}:</strong>
                <span>{pinnedAnnouncement.content}</span>
              </div>
              <div className="chatview-pinned-meta">
                {t('pinnedAnnouncement.meta', { author: pinnedAnnouncement.author ?? t('pinnedAnnouncement.systemAuthor') })}
                {pinnedAnnouncement.time && <span className="chatview-pinned-time">{pinnedAnnouncement.time}</span>}
              </div>
            </div>

            {pinnedAnnouncement.onCopy && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("aria.openPinned")}
                title={t("aria.openPinned")}
                onClick={pinnedAnnouncement.onCopy}
                type="button"
              >
                <ExternalLink size={14} />
              </Button>
            )}
            {pinnedAnnouncement.onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("aria.closePinned")}
                title={t("aria.closePinned")}
                onClick={pinnedAnnouncement.onDismiss}
                type="button"
              >
                <X size={14} />
              </Button>
            )}
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyTranscriptState {...(transcriptLoading ? { loading: true } : {})} />
      ) : (
        <TranscriptErrorBoundary>
          <Transcript ref={transcriptRef} items={items} chatMode={chatMode} unreadDivider={resolvedUnreadDivider} compactDividers={resolvedCompactDividers} {...(sessionId !== undefined ? { sessionId } : {})} {...(onAgentClick ? { onAgentClick } : {})} {...(onBlockContextMenu ? { onBlockContextMenu } : {})} {...(onBlockSelect ? { onBlockSelect } : {})} {...(onBlockAction ? { onBlockAction } : {})} {...(onReviewFile ? { onReviewFile } : {})} {...(onArtifactClick ? { onArtifactClick } : {})} {...(onCheckpointClick ? { onCheckpointClick } : {})} {...(onDeploySubmit ? { onDeploySubmit } : {})} {...(previewExternalOpenEnabled !== undefined ? { previewExternalOpenEnabled } : {})} {...(selectedBlockIds ? { selectedBlockIds } : {})} {...(selectionMode !== undefined ? { selectionMode } : {})} {...(softHiddenBlockIds ? { softHiddenBlockIds } : {})} {...(actionedBlockIds ? { actionedBlockIds } : {})} {...(renderUserFooter ? { renderUserFooter } : {})} />
          {/* Ephemeral typing indicator — shown when other session members are typing */}
          {typingUserNames && typingUserNames.length > 0 && (
            <TypingIndicator names={typingUserNames} chatMode={chatMode} />
          )}
        </TranscriptErrorBoundary>
      )}
      {/* Approval-arrival live region (#1503): OUTSIDE the virtualizer so it
          survives row unmounts; role=status implies aria-live="polite". */}
      <div aria-live="polite" className="chatview-live-region" role="status" style={visuallyHiddenStyle}>
        {approvalAnnouncement}
      </div>
    </div>
  )
})
