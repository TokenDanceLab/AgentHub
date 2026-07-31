import { useCallback, useEffect, useRef, useState } from 'react';

/** Feedback window before the "copied" flag flips back to false. */
const COPIED_FLAG_RESET_MS = 1500;

/**
 * Copy→Check feedback flag for copy buttons.
 *
 * Returns `[copied, markCopied]`: `markCopied()` flips `copied` to `true` and
 * schedules an automatic reset after `resetMs` (default 1500ms). Re-triggers
 * restart the timer; the pending timer is cleared on unmount.
 *
 * Usage:
 *   const [copied, markCopied] = useCopiedFlag();
 *   <button onClick={() => { navigator.clipboard.writeText(text).then(markCopied) }}>
 *     {copied ? <Check size={12} /> : <Copy size={12} />}
 *     {copied ? '已复制' : '复制'}
 *   </button>
 */
export function useCopiedFlag(
  resetMs: number = COPIED_FLAG_RESET_MS,
): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending reset timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const markCopied = useCallback(() => {
    setCopied(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, resetMs);
  }, [resetMs]);

  return [copied, markCopied];
}
