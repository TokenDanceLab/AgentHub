import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ChatMessage } from '@/components/ChatView.types';

interface UseAutoScrollOptions {
  /** Custom scroll-to-bottom implementation (e.g. virtualizer.scrollToIndex).
   *  When provided, flag-based auto-scroll detection is used instead of position-based. */
  scrollToBottomFn?: (force?: boolean) => void;
}

/**
 * Port of OpenCode's createAutoScroll pattern.
 *
 * Algorithm (from OpenCode source):
 * - Track whether user has manually scrolled up (threshold: 200px from bottom)
 * - If user is near bottom → auto-follow new messages
 * - If user has scrolled up → DON'T auto-scroll (they're reading history)
 * - When isStreaming starts → auto-scroll to bottom
 * - When new message arrives AND user is near bottom → scroll to bottom
 * - isNearBottom boolean for UI indicators
 *
 * When scrollToBottomFn is provided (virtual scroll):
 * - Uses flag-based detection: sets a flag before calling custom fn,
 *   clears after 100ms timeout, skips scroll events while flag is set
 * - Position-based markAutoScroll/isAutoScroll still used as fallback
 *
 * @param containerRef - Ref to the scrollable container element
 * @param deps.messages - Chat messages array (scroll on length change)
 * @param deps.isStreaming - Whether the agent is currently streaming
 * @param options.scrollToBottomFn - Optional custom scroll function (e.g. virtualizer.scrollToIndex)
 * @returns scrollToBottom function and isNearBottom flag
 */
export function useAutoScroll(
  containerRef: RefObject<HTMLDivElement | null>,
  deps: { messages: ChatMessage[]; isStreaming: boolean },
  options?: UseAutoScrollOptions,
): { scrollToBottom: (force?: boolean) => void; isNearBottom: boolean } {
  const BOTTOM_THRESHOLD = 200;
  const customFn = options?.scrollToBottomFn;

  const [isNearBottom, setIsNearBottom] = useState(true);
  const userScrolledRef = useRef(false);
  const autoScrollRef = useRef<{ top: number; time: number } | undefined>(undefined);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollRafRef = useRef<number | null>(null);
  const prevStreamingRef = useRef(deps.isStreaming);
  const prevMessageCountRef = useRef(deps.messages.length);
  // Flag-based detection for custom scroll function
  const flagRef = useRef(false);
  const flagTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Stable ref for customFn to avoid dependency churn
  const customFnRef = useRef(customFn);
  customFnRef.current = customFn;

  // ── Helpers ───────────────────────────────────

  const distanceFromBottom = useCallback(
    (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop,
    [],
  );

  const markAutoScroll = useCallback((el: HTMLElement) => {
    autoScrollRef.current = {
      top: Math.max(0, el.scrollHeight - el.clientHeight),
      time: Date.now(),
    };
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => {
      autoScrollRef.current = undefined;
      autoTimerRef.current = undefined;
    }, 1500);
  }, []);

  const isAutoScroll = useCallback((el: HTMLElement) => {
    const a = autoScrollRef.current;
    if (!a) return false;
    if (Date.now() - a.time > 1500) {
      autoScrollRef.current = undefined;
      return false;
    }
    return Math.abs(el.scrollTop - a.top) < 2;
  }, []);

  // ── Core scroll ───────────────────────────────

  const scrollToBottom = useCallback(
    (force?: boolean) => {
      const el = containerRef.current;
      if (!el) return;

      // If forcing, reset user-scrolled state
      if (force && userScrolledRef.current) {
        userScrolledRef.current = false;
        setIsNearBottom(true);
      }

      // Don't auto-scroll if user has scrolled away (unless forced)
      if (!force && userScrolledRef.current) return;

      const dist = distanceFromBottom(el);
      const fn = customFnRef.current;

      // Already at bottom — mark and skip
      if (dist < 2) {
        markAutoScroll(el);
        return;
      }

      if (fn) {
        // Flag-based detection: mark that we're auto-scrolling
        flagRef.current = true;
        if (flagTimerRef.current) clearTimeout(flagTimerRef.current);
        flagTimerRef.current = setTimeout(() => {
          flagRef.current = false;
          flagTimerRef.current = undefined;
        }, 1500);

        // Use requestAnimationFrame for coordination with DOM paint
        if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = requestAnimationFrame(() => {
          scrollRafRef.current = null;
          markAutoScroll(el);
          fn(force);
        });
        return;
      }

      // Default: DOM scroll
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        markAutoScroll(el);
        el.scrollTop = el.scrollHeight;
      });
    },
    [containerRef, distanceFromBottom, markAutoScroll],
  );

  // ── Scroll event handler ──────────────────────

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Flag-based: skip if we initiated this scroll via custom function
    if (customFnRef.current && flagRef.current) {
      return;
    }

    // Position-based: ignore scroll events triggered by our own scrollToBottom calls
    if (!userScrolledRef.current && isAutoScroll(el)) {
      return;
    }

    const dist = distanceFromBottom(el);
    const scrolled = dist > BOTTOM_THRESHOLD;

    // Only update if changed to avoid unnecessary re-renders
    if (userScrolledRef.current !== scrolled) {
      userScrolledRef.current = scrolled;
      setIsNearBottom(!scrolled);
    }
  }, [containerRef, distanceFromBottom, isAutoScroll]);

  // ── Wheel handler (pause auto-scroll on scroll up) ──

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (e.deltaY >= 0) return; // only care about scrolling up
      // If scrolling within a nested scrollable, don't treat as "leave follow"
      const target = e.target instanceof Element ? e.target : null;
      const nested = target?.closest('[data-scrollable]');
      const el = containerRef.current;
      if (el && nested && nested !== el) return;

      userScrolledRef.current = true;
      setIsNearBottom(false);
    },
    [containerRef],
  );

  // ── Effects ────────────────────────────────────

  // Auto-scroll when isStreaming starts (e.g. new user message sent)
  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = deps.isStreaming;

    // When streaming starts, force scroll to bottom
    if (deps.isStreaming && !prev) {
      scrollToBottom(true);
    }
  }, [deps.isStreaming, scrollToBottom]);

  // Auto-scroll when new messages arrive and user is near bottom
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    prevMessageCountRef.current = deps.messages.length;

    // New message arrived
    if (deps.messages.length > prev) {
      if (!userScrolledRef.current) {
        scrollToBottom(false);
      }
    }
  }, [deps.messages.length, scrollToBottom]);

  // Attach wheel listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: true });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [containerRef, handleWheel]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      if (flagTimerRef.current) clearTimeout(flagTimerRef.current);
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  return { scrollToBottom, isNearBottom };
}
