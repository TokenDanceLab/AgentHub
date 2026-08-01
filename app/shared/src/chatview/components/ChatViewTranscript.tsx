/* ═══════════════════════════════════════════════════════════════════════
   CHAT VIEW TRANSCRIPT — integration wrapper
   Wraps ChatView component tree. Theme deferred to consumer.
   Uses react-i18next with 'chatview' namespace (provided by consumer's outer I18nextProvider).
   ══════════════════════════════════════════════════════════════════════ */

import { Component, useMemo, useEffect, useRef, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Pin, X } from 'lucide-react'

import { Transcript, type TranscriptHandle } from './Transcript'
import { TypingIndicator } from './TypingIndicator'
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources'
import { blocksToTranscriptItems, resolveCompactDividerIndices, resolveUnreadAnchorItemIndex, type TranscriptBlock } from '../adapter'
import type { UnreadDividerDescriptor } from '../types'
import type { BlockActionCallback, TranscriptUserItem } from '../transcript-item'

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
  onDeploySubmit?: ((id: string) => void) | undefined
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
}

function EmptyState() {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE)
  return <div className="chatview-empty">{t('transcript.empty')}</div>
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

/**
 * Drop-in replacement for a transcript view (subset of props).
 * Takes TranscriptBlock[] from the upstream data source and renders via ChatView component tree.
 * i18n resolved via react-i18next (chatview namespace), co-existing with the consumer's root provider.
 */
export const ChatViewTranscript = memo(function ChatViewTranscript({ transcript, sessionId, chatMode = 'group', onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds, highlightedBlockId, onHighlightEnd, pinnedAnnouncement, connectionStatus, typingUserNames, renderUserFooter, unreadDivider }: Props) {
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

      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
              <Pin />
            </span>
            <div className="chatview-pinned-copy">
              <div className="chatview-pinned-line">
                <strong>{pinnedAnnouncement.title}:</strong>
                <span>{pinnedAnnouncement.content}</span>
              </div>
              <div className="chatview-pinned-meta">
                由 <a>{pinnedAnnouncement.author ?? '系统'}</a> 置顶
                {pinnedAnnouncement.time && <span className="chatview-pinned-time">{pinnedAnnouncement.time}</span>}
              </div>
            </div>

            {pinnedAnnouncement.onCopy && (
              <button
                aria-label="打开置顶内容"
                className="chatview-pinned-btn"
                onClick={pinnedAnnouncement.onCopy}
                title="打开置顶内容"
                type="button"
              >
                <ExternalLink />
              </button>
            )}
            {pinnedAnnouncement.onDismiss && (
              <button
                aria-label="关闭置顶"
                className="chatview-pinned-btn chatview-pinned-dismiss"
                onClick={pinnedAnnouncement.onDismiss}
                title="关闭置顶"
                type="button"
              >
                <X />
              </button>
            )}
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <TranscriptErrorBoundary>
          <Transcript ref={transcriptRef} items={items} chatMode={chatMode} unreadDivider={resolvedUnreadDivider} compactDividers={resolvedCompactDividers} {...(sessionId !== undefined ? { sessionId } : {})} {...(onAgentClick ? { onAgentClick } : {})} {...(onBlockContextMenu ? { onBlockContextMenu } : {})} {...(onBlockSelect ? { onBlockSelect } : {})} {...(onBlockAction ? { onBlockAction } : {})} {...(onReviewFile ? { onReviewFile } : {})} {...(onDeploySubmit ? { onDeploySubmit } : {})} {...(selectedBlockIds ? { selectedBlockIds } : {})} {...(selectionMode !== undefined ? { selectionMode } : {})} {...(softHiddenBlockIds ? { softHiddenBlockIds } : {})} {...(actionedBlockIds ? { actionedBlockIds } : {})} {...(renderUserFooter ? { renderUserFooter } : {})} />
          {/* Ephemeral typing indicator — shown when other session members are typing */}
          {typingUserNames && typingUserNames.length > 0 && (
            <TypingIndicator names={typingUserNames} chatMode={chatMode} />
          )}
        </TranscriptErrorBoundary>
      )}
    </div>
  )
})
