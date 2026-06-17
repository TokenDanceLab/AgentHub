/* ═══════════════════════════════════════════════════════════════════════
   CHAT VIEW TRANSCRIPT — integration wrapper
   Wraps ChatView component tree. Theme deferred to consumer.
   Uses react-i18next with 'chatview' namespace (provided by consumer's outer I18nextProvider).
   ══════════════════════════════════════════════════════════════════════ */

import { useMemo, useEffect, useRef, useCallback } from 'react'
import Transcript from './Transcript'
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
  selectedBlockIds?: Set<string>
  selectionMode?: boolean
  softHiddenBlockIds?: Set<string>
  actionedBlockIds?: Set<string>
  /** Scroll to and highlight the block with this id, then auto-clear after 3s. */
  highlightedBlockId?: string | null
  /** Called when the highlight animation completes (after ~3s). */
  onHighlightEnd?: () => void
}

function EmptyState() {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE)
  return <div className="chatview-empty">{t('transcript.empty')}</div>
}

/**
 * Drop-in replacement for a transcript view (subset of props).
 * Takes TranscriptBlock[] from the upstream data source and renders via ChatView component tree.
 * i18n resolved via react-i18next (chatview namespace), co-existing with the consumer's root provider.
 */
export function ChatViewTranscript({ transcript, chatMode = 'group', onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds, highlightedBlockId, onHighlightEnd }: Props) {
  const items = useMemo(() => blocksToTranscriptItems(transcript), [transcript])
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
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <Transcript items={items} chatMode={chatMode} onAgentClick={onAgentClick} onBlockContextMenu={onBlockContextMenu} onBlockSelect={onBlockSelect} onBlockAction={onBlockAction} onReviewFile={onReviewFile} selectedBlockIds={selectedBlockIds} selectionMode={selectionMode} softHiddenBlockIds={softHiddenBlockIds} actionedBlockIds={actionedBlockIds} />
      )}
    </div>
  )
}
