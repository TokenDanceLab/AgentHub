/* ═══════════════════════════════════════════════════════════════════════
   UNREAD DIVIDER — read watermark between transcript message groups
   Thin line + "N 条未读" copy (desktop IM path, T8). Optionally shows a
   read-through hint ("已读到 #seq") below the label.
   ══════════════════════════════════════════════════════════════════════ */

import React, { memo } from 'react'

interface UnreadDividerProps {
  label: string
  readThrough?: string | undefined
}

/** Render the unread-messages divider above the first unread message. */
export const UnreadDivider = memo(function UnreadDivider({ label, readThrough }: UnreadDividerProps) {
  return (
    <div className="unread-divider" role="separator" aria-label={label}>
      <span className="unread-divider-line" aria-hidden="true" />
      <span className="unread-divider-label">
        {label}
        {readThrough ? <span className="unread-divider-read-through">{readThrough}</span> : null}
      </span>
      <span className="unread-divider-line" aria-hidden="true" />
    </div>
  )
})
