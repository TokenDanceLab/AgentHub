import { useEffect, useState, useCallback, useRef } from "react";

interface KeyboardAvoidanceState {
  /** Current visual viewport height in px (fallback: window.innerHeight) */
  visualViewportHeight: number;
  /** Whether the soft keyboard is likely visible */
  isKeyboardVisible: boolean;
  /** Estimated keyboard height in px */
  keyboardHeight: number;
  /** CSS custom property overrides for the <html> element */
  cssVars: Record<string, string>;
}

/** Minimum keyboard height (px) to consider the keyboard "visible" — avoids false positives from small resizes. */
const KEYBOARD_THRESHOLD = 150;

function computeState(baseHeight: number): KeyboardAvoidanceState {
  const vv = window.visualViewport;
  const vvHeight = vv ? Math.round(vv.height) : window.innerHeight;
  const vvOffsetTop = vv ? Math.round(vv.offsetTop) : 0;
  const innerHeight = window.innerHeight;
  const refHeight = baseHeight > 0 ? baseHeight : innerHeight;

  // iOS / resize-mode: layout viewport shrinks when keyboard appears
  const heightDelta = refHeight - vvHeight;
  // Android overlay-mode: page scrolls so the focused element is visible
  const offsetDelta = Math.max(0, vvOffsetTop);

  // Use the strongest keyboard signal available across platforms
  const keyboardHeight = Math.max(heightDelta, offsetDelta);
  const isKeyboardVisible = keyboardHeight > KEYBOARD_THRESHOLD;

  // When the shell naturally shrinks (iOS / resize-mode), the grid layout
  // already keeps the composer inside the visible area.  Only compensate via
  // bottom padding when the shell height did NOT shrink but the keyboard
  // IS present (Android overlay-mode where offsetTop gives the signal).
  const shellAlreadyShrunk = heightDelta > KEYBOARD_THRESHOLD;
  const paddingCompensation =
    isKeyboardVisible && !shellAlreadyShrunk ? keyboardHeight : 0;

  return {
    visualViewportHeight: vvHeight,
    isKeyboardVisible,
    keyboardHeight,
    cssVars: {
      "--td-visual-viewport-height": `${vvHeight}px`,
      "--td-keyboard-height": `${paddingCompensation}px`,
      "--td-keyboard-visible": isKeyboardVisible ? "1" : "0",
    },
  };
}

/**
 * Provides keyboard-aware layout data using the Visual Viewport API.
 *
 * On iOS Safari, `window.visualViewport.height` shrinks when the soft keyboard
 * appears while `window.innerHeight` may stay fixed. This hook detects that
 * delta and exposes CSS custom properties so the layout can avoid occlusion.
 *
 * On Android browsers where the viewport does NOT resize but instead scrolls
 * the page (visualViewport.offsetTop changes), keyboard height is detected
 * from offsetTop and a padding-bottom compensation is applied.
 */
export function useKeyboardAvoidance(): KeyboardAvoidanceState {
  const [state, setState] = useState<KeyboardAvoidanceState>(() =>
    computeState(window.innerHeight),
  );
  const baseHeightRef = useRef(window.innerHeight);

  const updateState = useCallback(() => {
    setState(computeState(baseHeightRef.current));
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      // Graceful fallback: environment without visualViewport (e.g. older browsers)
      return;
    }

    // visualViewport.resize fires when the viewport shrinks (iOS, resize-mode Android)
    vv.addEventListener("resize", updateState);
    // visualViewport.scroll fires when the viewport is offset (overlay-mode Android)
    vv.addEventListener("scroll", updateState);

    // Also listen to window resize — some Android browsers change innerHeight
    // without firing visualViewport events.
    const onWindowResize = () => {
      baseHeightRef.current = window.innerHeight;
      updateState();
    };
    window.addEventListener("resize", onWindowResize);

    // Reset the baseline on orientation change so landscape/portrait delta is accurate
    const resetBaseOnOrientation = () => {
      // Small delay so innerHeight reflects the new orientation
      window.setTimeout(() => {
        baseHeightRef.current = window.innerHeight;
        updateState();
      }, 120);
    };
    window.addEventListener("orientationchange", resetBaseOnOrientation);

    // Initial measurement
    updateState();

    return () => {
      vv.removeEventListener("resize", updateState);
      vv.removeEventListener("scroll", updateState);
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("orientationchange", resetBaseOnOrientation);
    };
  }, [updateState]);

  return state;
}
