/* ═══════════════════════════════════════════════════════════════════════
   CHAT VIEW TRANSCRIPT — AgentHub integration wrapper
   Wraps ChatView component tree with its own I18nProvider (coexists with
   AgentHub's react-i18next via nested provider). Theme deferred to AgentHub.
   ══════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react'
import Transcript from './components/Transcript'
import { I18nProvider } from './i18n/I18nProvider'
import { blocksToTranscriptItems, type TranscriptBlock } from './adapter'

// Load ChatView design tokens — scoped to .chatview, no :root pollution
import './design/tokens.css'
import './theme/tokens-dark.css'

interface Props {
  transcript: TranscriptBlock[]
}

/**
 * Drop-in replacement for TranscriptView (subset of props).
 * Takes real AgentHub TranscriptBlock[] and renders via ChatView component tree.
 * Provides its own I18nProvider so ChatView's useI18n() resolves correctly.
 */
export function ChatViewTranscript({ transcript }: Props) {
  const [locale, setLocale] = useState<'zh-CN' | 'en-US'>('zh-CN')
  const items = useMemo(() => blocksToTranscriptItems(transcript) as any, [transcript])

  return (
    <div className="chatview">
      <I18nProvider locale={locale} setLocale={setLocale}>
        {items.length === 0 ? (
          <div style={{ padding: 'var(--sp-xl)', textAlign: 'center', color: 'var(--text-3)', font: 'var(--body)' }}>
            No messages yet. Start a conversation or select a channel.
          </div>
        ) : (
          <Transcript items={items} chatMode="group" />
        )}
      </I18nProvider>
    </div>
  )
}
