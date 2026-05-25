import { useRef, useCallback, useEffect } from 'react';

const DRAFT_PREFIX = 'ah:draft:';
const DEBOUNCE_MS = 500;

function getKey(threadId: string): string {
  return `${DRAFT_PREFIX}${threadId}`;
}

interface UseInputDraftReturn {
  /** Restore saved draft into the target textarea element. No-op if no draft exists. */
  restore: (el: HTMLTextAreaElement) => void;
  /** Schedule a debounced save of the current text. Only saves if text.length > 0. */
  save: (text: string) => void;
  /** Immediately persist the current text (skips debounce). Override threadId for cleanup cases. */
  flush: (text: string, tid?: string) => void;
  /** Remove the draft entry from localStorage for the current thread. */
  clear: () => void;
}

/**
 * Persist textarea content to localStorage keyed by threadId.
 * Debounced auto-save (500ms), restores on thread switch, clears on send.
 */
export function useInputDraft(threadId: string | undefined): UseInputDraftReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  // Clean up pending timer on unmount or threadId change
  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
    };
  }, [threadId]);

  const restore = useCallback((el: HTMLTextAreaElement) => {
    const tid = threadIdRef.current;
    if (!tid) return;
    const saved = localStorage.getItem(getKey(tid));
    if (saved) {
      el.value = saved;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, []);

  const save = useCallback((text: string) => {
    const tid = threadIdRef.current;
    if (!tid) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (text.length > 0) {
        localStorage.setItem(getKey(tid), text);
      }
    }, DEBOUNCE_MS);
  }, []);

  const flush = useCallback((text: string, tid?: string) => {
    clearTimeout(timerRef.current);
    const effectiveTid = tid ?? threadIdRef.current;
    if (effectiveTid && text.length > 0) {
      localStorage.setItem(getKey(effectiveTid), text);
    }
  }, []);

  const clear = useCallback(() => {
    const tid = threadIdRef.current;
    if (!tid) return;
    localStorage.removeItem(getKey(tid));
  }, []);

  return { restore, save, flush, clear };
}
