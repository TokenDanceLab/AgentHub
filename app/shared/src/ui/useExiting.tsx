import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../chatview/design/motion'

/** Exit-transition state (#1825): keeps a component mounted for `exitMs`
 *  after `open` flips false so CSS exit animations can play, then unmounts.
 *  Returns { mounted, exiting }:
 *   - mounted: render while true, unmount when false.
 *   - exiting: true during the exit window — apply the exiting class.
 *  Under prefers-reduced-motion the mount drops immediately (no phantom
 *  delay), matching the CSS policy of instant state flips. */
export function useExiting(open: boolean, exitMs: number): { mounted: boolean; exiting: boolean } {
  const [mounted, setMounted] = useState(open)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setExiting(false)
      return undefined
    }
    if (!mounted) return undefined
    if (prefersReducedMotion()) {
      setMounted(false)
      setExiting(false)
      return undefined
    }
    setExiting(true)
    const timer = setTimeout(() => {
      setMounted(false)
      setExiting(false)
    }, exitMs)
    return () => clearTimeout(timer)
  }, [open, mounted, exitMs])

  return { mounted, exiting }
}
