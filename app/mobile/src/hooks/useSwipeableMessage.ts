import { useRef, useCallback, useState, useEffect, type TouchEvent as ReactTouchEvent } from "react";

export interface SwipeableMessageHandlers {
  onReply?: () => void;
  onCopy?: () => void;
  onForward?: () => void;
  isOwn?: boolean;
  disabled?: boolean;
}

const ACTION_WIDTH = 180; // px — max reveal width for action buttons
const SWIPE_ACTIVATE_THRESHOLD = 10; // px — minimum dx before activating horizontal swipe
const SWIPE_SNAP_THRESHOLD = 0.4; // ratio — snap to open if past this fraction of ACTION_WIDTH

interface TouchState {
  startX: number;
  startY: number;
  prevTranslateX: number;
  active: boolean;
  swipeActive: boolean;
}

export function useSwipeableMessage(handlers: SwipeableMessageHandlers) {
  const [translateX, setTranslateX] = useState(0);
  const [showActions, setShowActions] = useState(false);
  const touchRef = useRef<TouchState>({
    startX: 0,
    startY: 0,
    prevTranslateX: 0,
    active: false,
    swipeActive: false,
  });

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      if (handlers.disabled) return;
      const touch = e.touches[0];
      if (!touch) return;
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        prevTranslateX: translateX,
        active: true,
        swipeActive: false,
      };
    },
    [handlers.disabled, translateX],
  );

  const onTouchMove = useCallback(
    (e: ReactTouchEvent) => {
      if (!touchRef.current.active) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - touchRef.current.startX;
      const dy = touch.clientY - touchRef.current.startY;

      if (!touchRef.current.swipeActive) {
        if (Math.abs(dx) > SWIPE_ACTIVATE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
          touchRef.current.swipeActive = true;
        } else if (Math.abs(dy) > SWIPE_ACTIVATE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
          touchRef.current.active = false;
          return;
        } else {
          return;
        }
      }

      const rawX = touchRef.current.prevTranslateX + dx;
      // Only allow left-swipe (negative) for isOwn; allow either for others
      const minX = handlers.isOwn ? -ACTION_WIDTH : 0;
      const maxX = handlers.isOwn ? 0 : ACTION_WIDTH;
      const clamped = Math.max(minX, Math.min(maxX, rawX));
      setTranslateX(clamped);
    },
    [handlers.isOwn],
  );

  const onTouchEnd = useCallback(() => {
    if (!touchRef.current.active || !touchRef.current.swipeActive) {
      touchRef.current.active = false;
      touchRef.current.swipeActive = false;
      return;
    }
    touchRef.current.active = false;
    touchRef.current.swipeActive = false;

    const absX = Math.abs(translateX);
    const shouldSnap = absX > ACTION_WIDTH * SWIPE_SNAP_THRESHOLD;
    const targetX = shouldSnap ? (handlers.isOwn ? -ACTION_WIDTH : ACTION_WIDTH) : 0;

    setTranslateX(targetX);
    setShowActions(targetX !== 0);
  }, [translateX, handlers.isOwn]);

  const closeActions = useCallback(() => {
    setTranslateX(0);
    setShowActions(false);
  }, []);

  return {
    translateX,
    showActions,
    actionWidth: ACTION_WIDTH,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    closeActions,
  };
}

// ─── Long-press gesture hook ───

export interface LongPressHandlers {
  onLongPress?: () => void;
}

const LONG_PRESS_DURATION = 500; // ms
const LONG_PRESS_MOVE_TOLERANCE = 10; // px

interface LongPressTouchState {
  startX: number;
  startY: number;
  moved: boolean;
}

export function useLongPress(onLongPress?: () => void) {
  const touchRef = useRef<LongPressTouchState | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        moved: false,
      };
      longPressTriggered.current = false;

      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        if (touchRef.current && !touchRef.current.moved) {
          longPressTriggered.current = true;
          onLongPress?.();
        }
      }, LONG_PRESS_DURATION);
    },
    [onLongPress, clearLongPress],
  );

  const onTouchMove = useCallback(
    (e: ReactTouchEvent) => {
      if (!touchRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = Math.abs(touch.clientX - touchRef.current.startX);
      const dy = Math.abs(touch.clientY - touchRef.current.startY);

      if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
        touchRef.current.moved = true;
        clearLongPress();
      }
    },
    [clearLongPress],
  );

  const onTouchEnd = useCallback(() => {
    clearLongPress();
    touchRef.current = null;
  }, [clearLongPress]);

  useEffect(() => () => { clearLongPress(); }, [clearLongPress]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}

// ─── Pull-down-to-refresh gesture hook ───

const PULL_DOWN_THRESHOLD = 80; // px

interface PullTouchState {
  startX: number;
  startY: number;
}

export function usePullDownGesture(
  containerRef: React.RefObject<HTMLDivElement | null>,
  onPullDown?: () => void,
  isLoading = false,
) {
  const touchRef = useRef<PullTouchState | null>(null);
  const pullTriggered = useRef(false);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      const container = containerRef.current;
      if (!container || container.scrollTop > 5 || isLoading) return;

      const touch = e.touches[0];
      if (!touch) return;
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
      };
      pullTriggered.current = false;
    },
    [containerRef, isLoading],
  );

  const onTouchMove = useCallback(
    (e: ReactTouchEvent) => {
      if (!touchRef.current || pullTriggered.current || isLoading) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dy = touch.clientY - touchRef.current.startY;
      const dx = Math.abs(touch.clientX - touchRef.current.startX);

      if (dy > PULL_DOWN_THRESHOLD && dy > dx * 1.5) {
        pullTriggered.current = true;
        onPullDown?.();
      }
    },
    [onPullDown, isLoading],
  );

  const onTouchEnd = useCallback(() => {
    touchRef.current = null;
  }, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}
