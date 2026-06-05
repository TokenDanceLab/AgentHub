import { useCallback } from 'react';
import type { KeyboardEvent } from 'react';

export interface ComposerCoreOptions {
  disabled?: boolean;
  isStreaming?: boolean;
  isStarting?: boolean;
}

export interface ComposerCoreReturn {
  /** Whether the composer is in a state that allows sending. */
  canSend: boolean;
  /** Auto-resize a textarea to fit its content. */
  autoResize: (textarea: HTMLTextAreaElement) => void;
  /** Reset textarea: clear value and collapse height. */
  clearTextarea: (textarea: HTMLTextAreaElement) => void;
  /**
   * Handle Enter/Shift+Enter for a composer textarea.
   * Returns true if the event was handled (Enter without Shift -> send).
   */
  handleEnterKey: (e: KeyboardEvent, sendAction: () => void) => boolean;
  /**
   * Validate and trim text for sending.
   * Returns the trimmed text, or null if sending should be blocked.
   */
  trimForSend: (text: string) => string | null;
}

export function useComposerCore(options: ComposerCoreOptions = {}): ComposerCoreReturn {
  const { disabled = false, isStreaming = false, isStarting = false } = options;

  const canSend = !disabled && !isStreaming && !isStarting;

  const trimForSend = useCallback(
    (text: string): string | null => {
      if (!canSend) return null;
      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    [canSend],
  );

  const autoResize = useCallback((textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }, []);

  const clearTextarea = useCallback((textarea: HTMLTextAreaElement) => {
    textarea.value = '';
    textarea.style.height = 'auto';
  }, []);

  const handleEnterKey = useCallback(
    (e: KeyboardEvent, sendAction: () => void): boolean => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAction();
        return true;
      }
      return false;
    },
    [],
  );

  return { canSend, autoResize, clearTextarea, handleEnterKey, trimForSend };
}
