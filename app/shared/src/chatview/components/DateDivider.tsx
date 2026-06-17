/* ═══════════════════════════════════════════════════════════════════════
   DATADIVIDER — day boundary between transcript message groups
   Renders a centered date label (e.g. "June 17, 2026") when the day changes.
   ══════════════════════════════════════════════════════════════════════ */

import React, { memo } from 'react'

interface DateDividerProps {
  date: string
}

/** Render a date separator between transcript message groups. */
export const DateDivider = memo(function DateDivider({ date }: DateDividerProps) {
  return <div className="date-divider" role="separator" aria-label={date}>{date}</div>
})
