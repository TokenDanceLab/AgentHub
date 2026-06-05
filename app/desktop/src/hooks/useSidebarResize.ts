import { useCallback } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { clamp } from '@/utils/appUtils';
import { useUIStore } from '@/stores/uiStore';
import styles from '@/App.module.css';

const LEFT_SIDEBAR_MIN = 248;
const LEFT_SIDEBAR_MAX = 420;

export function useSidebarResize() {
  const { leftSidebarWidth, setLeftSidebarWidth } = useUIStore((s) => ({
    leftSidebarWidth: s.sidebarWidth,
    setLeftSidebarWidth: s.setSidebarWidth,
  }));

  const handleStartResize = useCallback(
    (side: 'left' | 'right') => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const initialLeft = leftSidebarWidth;

      const handleMove = (moveEvent: PointerEvent) => {
        if (side === 'left') {
          const nextLeft = clamp(
            initialLeft + moveEvent.clientX - startX,
            LEFT_SIDEBAR_MIN,
            LEFT_SIDEBAR_MAX,
          );
          setLeftSidebarWidth(nextLeft);
        }
      };

      const handleUp = () => {
        document.body.classList.remove(styles.resizing ?? '');
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };

      document.body.classList.add(styles.resizing ?? '');
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp, { once: true });
    },
    [leftSidebarWidth, setLeftSidebarWidth],
  );

  const handleResizeKeyDown = useCallback(
    (side: 'left' | 'right') => (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 40 : 16;
      let nextWidth: number | null = null;

      if (side === 'left') {
        if (event.key === 'ArrowLeft') nextWidth = leftSidebarWidth - step;
        if (event.key === 'ArrowRight') nextWidth = leftSidebarWidth + step;
        if (event.key === 'Home') nextWidth = LEFT_SIDEBAR_MIN;
        if (event.key === 'End') nextWidth = LEFT_SIDEBAR_MAX;
        if (nextWidth != null) {
          event.preventDefault();
          const clamped = clamp(nextWidth, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX);
          setLeftSidebarWidth(clamped);
        }
        return;
      }
    },
    [leftSidebarWidth, setLeftSidebarWidth],
  );

  return { handleStartResize, handleResizeKeyDown } as const;
}
