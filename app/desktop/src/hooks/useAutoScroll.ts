import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ChatMessage } from '@/components/ChatView.types';

interface UseAutoScrollOptions {
  /** Custom scroll-to-bottom implementation (e.g. virtualizer.scrollToIndex).
   *  When provided, flag-based auto-scroll detection is used instead of position-based. */
  scrollToBottomFn?: (force?: boolean) => void;
}

/**
 * Auto-follow chat output while preserving manual history reading.
 *
 * ChatView renders in normal document flow. This hook therefore uses only DOM
 * scroll state; there is no virtual-list custom path or estimated row height.
 *
 * When scrollToBottomFn is provided (virtual scroll):
 * - Uses flag-based detection: sets a flag before calling custom fn,
 *   clears after 300ms timeout, skips scroll events while flag is set
 * - Position-based markAutoScroll/isAutoScroll still used as fallback
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
    const state = autoScrollRef.current;
    if (!state) return false;
    if (Date.now() - state.time > 1500) {
      autoScrollRef.current = undefined;
      return false;
    }
    return Math.abs(el.scrollTop - state.top) < 2;
  }, []);

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
        }, 300);

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

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Flag-based: skip if we initiated this scroll via custom function
    if (customFnRef.current && flagRef.current) {
      return;
    }

    // Position-based: ignore scroll events triggered by our own scrollToBottom calls
    if (!userScrolledRef.current && isAutoScroll(el)) return;

    const scrolled = distanceFromBottom(el) > BOTTOM_THRESHOLD;
    if (userScrolledRef.current !== scrolled) {
      userScrolledRef.current = scrolled;
      setIsNearBottom(!scrolled);
    }
  }, [containerRef, distanceFromBottom, isAutoScroll]);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (event.deltaY >= 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const nested = target?.closest('[data-scrollable]');
      const el = containerRef.current;
      if (el && nested && nested !== el) return;

      userScrolledRef.current = true;
      setIsNearBottom(false);
    },
    [containerRef],
  );

  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = deps.isStreaming;

    // When streaming starts, force scroll to bottom
    if (deps.isStreaming && !prev) {
      scrollToBottom(true);
    }
  }, [deps.isStreaming, scrollToBottom]);

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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('wheel', handleWheel);
    };
  }, [containerRef, handleScroll, handleWheel]);

  useEffect(() => {
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      if (flagTimerRef.current) clearTimeout(flagTimerRef.current);
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  return { scrollToBottom, isNearBottom };
}
