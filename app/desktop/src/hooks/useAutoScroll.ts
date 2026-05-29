import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ChatMessage } from '@/components/ChatView.types';

/**
 * Auto-follow chat output while preserving manual history reading.
 *
<<<<<<< HEAD
 * ChatView renders in normal document flow. When a virtual-list custom path is
 * provided via scrollToBottomFn, flag-based detection keeps scroll-event noise
 * from the custom scroll from being mistaken for a user gesture.
=======
 * ChatView renders in normal document flow. This hook therefore uses only DOM
 * scroll state; there is no virtual-list custom path or estimated row height.
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
 */
export function useAutoScroll(
  containerRef: RefObject<HTMLDivElement | null>,
  deps: { messages: ChatMessage[]; isStreaming: boolean },
): { scrollToBottom: (force?: boolean) => void; isNearBottom: boolean } {
  const BOTTOM_THRESHOLD = 200;
  const [isNearBottom, setIsNearBottom] = useState(true);
  const userScrolledRef = useRef(false);
  const autoScrollRef = useRef<{ top: number; time: number } | undefined>(undefined);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollRafRef = useRef<number | null>(null);
  const prevStreamingRef = useRef(deps.isStreaming);
  const prevMessageCountRef = useRef(deps.messages.length);
<<<<<<< HEAD

  // Flag-based detection for custom scroll function
  const flagRef = useRef(false);
  const flagTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Stable ref for customFn to avoid dependency churn
  const customFnRef = useRef(customFn);
  useEffect(() => {
    customFnRef.current = customFn;
  }, [customFn]);
=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)

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

<<<<<<< HEAD
  const scrollToBottom = useCallback(
    (force?: boolean) => {
      const el = containerRef.current;
      if (!el) return;

      if (force && userScrolledRef.current) {
        userScrolledRef.current = false;
        setIsNearBottom(true);
      }

      if (!force && userScrolledRef.current) return;

      const dist = distanceFromBottom(el);
      const fn = customFnRef.current;

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
        el.scrollTop = el.scrollHeight;
        markAutoScroll(el);
      });
    },
    [containerRef, distanceFromBottom, markAutoScroll],
  );
=======
  const scrollToBottom = useCallback((force?: boolean) => {
    const el = containerRef.current;
    if (!el) return;

    if (force && userScrolledRef.current) {
      userScrolledRef.current = false;
      setIsNearBottom(true);
    }

    if (!force && userScrolledRef.current) return;

    const dist = distanceFromBottom(el);
    if (dist < 2) {
      markAutoScroll(el);
      return;
    }

    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      el.scrollTop = el.scrollHeight;
      markAutoScroll(el);
    });
  }, [containerRef, distanceFromBottom, markAutoScroll]);
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!userScrolledRef.current && isAutoScroll(el)) return;

<<<<<<< HEAD
    if (!userScrolledRef.current && isAutoScroll(el)) return;

=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
    const scrolled = distanceFromBottom(el) > BOTTOM_THRESHOLD;
    if (userScrolledRef.current !== scrolled) {
      userScrolledRef.current = scrolled;
      setIsNearBottom(!scrolled);
    }
  }, [containerRef, distanceFromBottom, isAutoScroll]);

  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.deltaY >= 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const nested = target?.closest('[data-scrollable]');
    const el = containerRef.current;
    if (el && nested && nested !== el) return;

    userScrolledRef.current = true;
    setIsNearBottom(false);
  }, [containerRef]);

  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = deps.isStreaming;
    if (deps.isStreaming && !prev) {
      scrollToBottom(false);
    }
  }, [deps.isStreaming, scrollToBottom]);

  useEffect(() => {
    const prev = prevMessageCountRef.current;
    prevMessageCountRef.current = deps.messages.length;
    if (deps.messages.length > prev) {
      scrollToBottom(false);
    }
  }, [deps.messages.length, scrollToBottom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('wheel', handleWheel, { passive: true });
<<<<<<< HEAD
    return () => {
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('wheel', handleWheel);
    };
  }, [containerRef, handleScroll, handleWheel]);

  // Cleanup timers on unmount
  useEffect(() => {
=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
    return () => {
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('wheel', handleWheel);
    };
  }, [containerRef, handleScroll, handleWheel]);

  useEffect(() => () => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
<<<<<<< HEAD
    if (flagTimerRef.current) clearTimeout(flagTimerRef.current);
=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  return { scrollToBottom, isNearBottom };
}
