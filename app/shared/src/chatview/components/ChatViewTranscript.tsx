/* ═══════════════════════════════════════════════════════════════════════
   CHAT VIEW TRANSCRIPT — integration wrapper
   Wraps ChatView component tree. Theme deferred to consumer.
   Uses react-i18next with 'chatview' namespace (provided by consumer's outer I18nextProvider).
   ══════════════════════════════════════════════════════════════════════ */

import { Component, useMemo, useEffect, useRef, useCallback, memo } from 'react'
import { Transcript } from './Transcript'
import { useTranslation } from 'react-i18next'
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources'
import { blocksToTranscriptItems, type TranscriptBlock } from '../adapter'
import type { BlockActionCallback } from '../transcript-item'

// Load ChatView design tokens — scoped to .chatview, no :root pollution
import '../design/tokens.css'

interface Props {
  transcript: TranscriptBlock[]
  /** DM or group mode. Inferred from agent count when not provided. */
  chatMode?: 'dm' | 'group'
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
  /** Scroll to and highlight the block with this id, then auto-clear after 3s. */
  highlightedBlockId?: string | null
  /** Called when the highlight animation completes (after ~3s). */
  onHighlightEnd?: () => void
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
export const ChatViewTranscript = memo(function ChatViewTranscript({ transcript, chatMode = 'group', onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds, highlightedBlockId, onHighlightEnd, pinnedAnnouncement, connectionStatus }: Props) {
  const items = useMemo(() => {
    try {
      return blocksToTranscriptItems(transcript)
    } catch (err) {
      console.error('[ChatViewTranscript] blocksToTranscriptItems failed:', err)
      return []
    }
  }, [transcript])
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
    <div className="chatview" ref={containerRef}>
      {pinnedAnnouncement && (
        <div className="chatview-pinned-banner">
          <div className="chatview-pinned-header">
            <span className="chatview-pinned-title">{pinnedAnnouncement.title}</span>
            <div className="chatview-pinned-actions">
              {pinnedAnnouncement.onCopy && (
                <button className="chatview-pinned-btn" onClick={pinnedAnnouncement.onCopy} type="button">Copy</button>
              )}
              {pinnedAnnouncement.onDismiss && (
                <button className="chatview-pinned-btn chatview-pinned-dismiss" onClick={pinnedAnnouncement.onDismiss} type="button">Dismiss</button>
              )}
            </div>
          </div>
          <div className="chatview-pinned-body">{pinnedAnnouncement.content}</div>
          {(pinnedAnnouncement.author || pinnedAnnouncement.time) && (
            <div className="chatview-pinned-meta">
              {pinnedAnnouncement.author}
              {pinnedAnnouncement.time && <span className="chatview-pinned-time">{pinnedAnnouncement.time}</span>}
            </div>
          )}
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <TranscriptErrorBoundary>
          <Transcript items={items} chatMode={chatMode} {...(onAgentClick ? { onAgentClick } : {})} {...(onBlockContextMenu ? { onBlockContextMenu } : {})} {...(onBlockSelect ? { onBlockSelect } : {})} {...(onBlockAction ? { onBlockAction } : {})} {...(onReviewFile ? { onReviewFile } : {})} {...(onDeploySubmit ? { onDeploySubmit } : {})} {...(selectedBlockIds ? { selectedBlockIds } : {})} {...(selectionMode !== undefined ? { selectionMode } : {})} {...(softHiddenBlockIds ? { softHiddenBlockIds } : {})} {...(actionedBlockIds ? { actionedBlockIds } : {})} />
        </TranscriptErrorBoundary>
      )}
    </div>
  )
})
