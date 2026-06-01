import React, { type ReactNode } from "react";
import { useSwipeableMessage, useLongPress, type SwipeableMessageHandlers } from "./useSwipeableMessage";
import { Copy, Reply, Share } from "lucide-react";

interface SwipeableMessageRowProps {
  isUser: boolean;
  onReply?: () => void;
  onCopy?: () => void;
  onForward?: () => void;
  onLongPress?: () => void;
  children: ReactNode;
}

/**
 * Wraps a message bubble with swipe-to-reveal actions (reply/copy/forward)
 * and long-press-to-context-menu gesture support.
 */
export function SwipeableMessageRow({
  isUser,
  onReply,
  onCopy,
  onForward,
  onLongPress,
  children,
}: SwipeableMessageRowProps) {
  const swipeHandlers: SwipeableMessageHandlers = {
    onReply,
    onCopy,
    onForward,
    isOwn: isUser,
  };

  const { translateX, showActions, actionWidth, onTouchStart, onTouchMove, onTouchEnd, closeActions } =
    useSwipeableMessage(swipeHandlers);

  const longPress = useLongPress(onLongPress);

  const handleTouchStart = (e: React.TouchEvent) => {
    onTouchStart(e);
    longPress.onTouchStart(e);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    onTouchMove(e);
    longPress.onTouchMove(e);
  };

  const handleTouchEnd = () => {
    onTouchEnd();
    longPress.onTouchEnd();
  };

  const swipedOpen = Math.abs(translateX) > 10;

  return (
    <div
      style={{ position: "relative", overflow: "hidden" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Action buttons revealed behind the message */}
      <div
        aria-hidden={!showActions}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 10px",
          pointerEvents: showActions ? "auto" : "none",
          opacity: showActions ? 1 : 0,
          transition: "opacity 120ms",
        }}
      >
        {onReply && (
          <button
            type="button"
            aria-label="Reply"
            onClick={() => {
              swipeHandlers.onReply?.();
              closeActions();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              border: "1px solid var(--td-line)",
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.06)",
              color: "var(--td-ink-70)",
              cursor: "pointer",
            }}
          >
            <Reply size={15} />
          </button>
        )}
        {onCopy && (
          <button
            type="button"
            aria-label="Copy"
            onClick={() => {
              swipeHandlers.onCopy?.();
              closeActions();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              border: "1px solid var(--td-line)",
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.06)",
              color: "var(--td-ink-70)",
              cursor: "pointer",
            }}
          >
            <Copy size={14} />
          </button>
        )}
        {onForward && (
          <button
            type="button"
            aria-label="Forward"
            onClick={() => {
              swipeHandlers.onForward?.();
              closeActions();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              border: "1px solid var(--td-line)",
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.06)",
              color: "var(--td-ink-70)",
              cursor: "pointer",
            }}
          >
            <Share size={14} />
          </button>
        )}
      </div>

      {/* Message content — slides to reveal actions */}
      <div
        style={{
          transform: `translateX(${translateX}px)`,
          transition: swipedOpen ? "transform 180ms ease-out" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
