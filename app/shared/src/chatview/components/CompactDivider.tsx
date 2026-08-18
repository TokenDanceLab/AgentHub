/* ═══════════════════════════════════════════════════════════════════════
   COMPACT DIVIDER — context compaction boundary in the transcript stream
   Thin line + "上下文已压缩" label with optional detail (trigger, preTokens).
   Rendered as an inline divider segment (like UnreadDivider / DateDivider).
   ══════════════════════════════════════════════════════════════════════ */

import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { CHATVIEW_I18N_NAMESPACE } from '../i18n/resources'

interface CompactDividerProps {
  /** Compaction trigger, e.g. "auto" or "manual". */
  trigger?: string | undefined
  /** Token count before compaction. */
  preTokens?: number | undefined
}

function formatPreTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

/** Render a compact-boundary divider between transcript message groups. */
export const CompactDivider = memo(function CompactDivider({ trigger, preTokens }: CompactDividerProps) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE)
  const parts: string[] = [t('compactDivider.label')]
  if (trigger === 'auto') parts.push(t('compactDivider.auto'))
  if (preTokens != null) parts.push(t('compactDivider.tokensAgo', { tokens: formatPreTokens(preTokens) }))

  const label = parts.join(' ')

  return (
    <div className="compact-divider" role="separator" aria-label={label}>
      <span className="compact-divider-line" aria-hidden="true" />
      <span className="compact-divider-label">{label}</span>
      <span className="compact-divider-line" aria-hidden="true" />
    </div>
  )
})
