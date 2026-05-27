import { useState, useEffect, useRef } from 'react';

/**
 * Kanna's drainingStreams pattern:
 * Batches incoming text updates at 16ms intervals for smooth streaming.
 * Instead of re-rendering on every text_delta event,
 * accumulated text is flushed to the display at ~60fps.
 * On stream end, any remaining buffered text is flushed immediately.
 */
export function useStreamingText(incoming: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState(incoming);
  const bufferRef = useRef(incoming);

  // Keep buffer in sync with latest incoming text (deferred to avoid lint)
  useEffect(() => {
    bufferRef.current = incoming;
  });

  useEffect(() => {
    if (!isStreaming) {
      // Stream ended — flush remaining buffer immediately
      setDisplayed(bufferRef.current);
      return;
    }

    // Drain buffer every 16ms (~60fps)
    const id = setInterval(() => {
      setDisplayed(bufferRef.current);
    }, 16);

    return () => clearInterval(id);
  }, [isStreaming]);

  return displayed;
}
