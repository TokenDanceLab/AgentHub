import { useState, useEffect, useCallback } from 'react';
import { readHiddenMessageIds, writeHiddenMessageIds } from '@/utils/appUtils';

/**
 * Per-thread hidden message ID management backed by localStorage.
 * Resets when threadId changes.
 */
export function useHiddenMessages(activeThreadId: string | null | undefined) {
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(
    () => readHiddenMessageIds(activeThreadId),
  );

  useEffect(() => {
    setHiddenMessageIds(readHiddenMessageIds(activeThreadId));
  }, [activeThreadId]);

  const hideMessage = useCallback(
    (messageId: string) => {
      setHiddenMessageIds((prev) => {
        const next = new Set(prev);
        next.add(messageId);
        writeHiddenMessageIds(activeThreadId, next);
        return next;
      });
    },
    [activeThreadId],
  );

  return { hiddenMessageIds, hideMessage } as const;
}
