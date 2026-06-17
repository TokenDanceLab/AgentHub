/* ═══════════════════════════════════════════════════════════════════════
   CHAT VIEW TRANSCRIPT — integration wrapper
   Wraps ChatView component tree. Theme deferred to consumer.
   Uses react-i18next with 'chatview' namespace (provided by consumer's outer I18nextProvider).
   ══════════════════════════════════════════════════════════════════════ */

import { useMemo } from 'react'
import Transcript from './Transcript'
import { useTranslation } from 'react-i18next'
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources'
import { blocksToTranscriptItems, type TranscriptBlock } from '../adapter'

// Load ChatView design tokens — scoped to .chatview, no :root pollution
import '../design/tokens.css'

interface Props {
  transcript: TranscriptBlock[]
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
export function ChatViewTranscript({ transcript }: Props) {
  const items = useMemo(() => blocksToTranscriptItems(transcript), [transcript])

  return (
    <div className="chatview">
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <Transcript items={items} chatMode="group" />
      )}
    </div>
  )
}
