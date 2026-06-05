import { useEffect } from 'react';
import { FOCUS_NAVIGATION_KEYS } from '@/utils/appUtils';

export default function useFocusSourceTracking() {
  useEffect(() => {
    const root = document.documentElement;
    const setPointerSource = () => {
      root.dataset.focusSource = 'pointer';
    };
    const setKeyboardSource = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (FOCUS_NAVIGATION_KEYS.has(event.key)) {
        root.dataset.focusSource = 'keyboard';
      }
    };

    root.dataset.focusSource ||= 'keyboard';
    window.addEventListener('pointerdown', setPointerSource, true);
    window.addEventListener('mousedown', setPointerSource, true);
    window.addEventListener('touchstart', setPointerSource, true);
    window.addEventListener('keydown', setKeyboardSource, true);

    return () => {
      window.removeEventListener('pointerdown', setPointerSource, true);
      window.removeEventListener('mousedown', setPointerSource, true);
      window.removeEventListener('touchstart', setPointerSource, true);
      window.removeEventListener('keydown', setKeyboardSource, true);
    };
  }, []);
}
