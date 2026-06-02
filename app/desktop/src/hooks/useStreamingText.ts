import { useState, useEffect, useRef } from 'react';

/**
 * Kanna's drainingStreams pattern:
 * Batches incoming text updates at display refresh rate for smooth streaming.
 * Uses requestAnimationFrame instead of setInterval:
 *  - Matches display refresh rate exactly (no wasted renders).
 *  - Pauses automatically when the tab is hidden (no CPU waste).
 *  - On visibility restore or stream end, remaining buffer flushes immediately.
 */
export function useStreamingText(incoming: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState(incoming);
  const bufferRef = useRef(incoming);
  const rafIdRef = useRef<number | null>(null);
  const visibleRef = useRef(true);

  // Keep buffer in sync with latest incoming text
  useEffect(() => {
    bufferRef.current = incoming;
  });

  // Track page visibility
  useEffect(() => {
    const handleVisibility = () => {
      visibleRef.current = document.visibilityState === 'visible';
      // Flush any buffered text immediately when tab becomes visible
      if (visibleRef.current && isStreaming) {
        setDisplayed(bufferRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming) {
      // Stream ended — flush remaining buffer immediately
      setDisplayed(bufferRef.current);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return;
    }

    // RAF loop: only renders when visible, otherwise skips frames
    let running = true;
    const tick = () => {
      if (!running) return;
      if (visibleRef.current) {
        setDisplayed(bufferRef.current);
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isStreaming]);

  return displayed;
}
