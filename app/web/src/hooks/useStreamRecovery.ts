import { useEffect, useRef, useCallback } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { createHubClient, type AgentRunEvent } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { mergeAgentRunEvents } from '@/utils/hubAdapters';

/**
 * Manages WebSocket stream event recovery after a reconnection.
 *
 * Three coordinated effects:
 * 1. Track the highest event seq for the current run (cursor for recovery).
 * 2. On WebSocket reconnection, fetch missed events with exponential backoff
 *    (matches Desktop's eventClient.ts: base 1s, double each retry, max 30s,
 *    +/-20% jitter, max 3 fetch attempts).
 * 3. Clear recovery state when the run changes (new task started).
 *
 * Returns a `retryRecovery` callback for the "retry" button in the recovery
 * failure banner.
 */
export function useStreamRecovery({
  optimisticRun,
  taskRunEvents,
  setTaskRunEvents,
  hubClient,
  justReconnected,
  isConnected,
}: {
  optimisticRun: { runId?: string } | null;
  taskRunEvents: AgentRunEvent[];
  setTaskRunEvents: React.Dispatch<React.SetStateAction<AgentRunEvent[]>>;
  hubClient: ReturnType<typeof createHubClient>;
  justReconnected: boolean;
  isConnected: boolean;
}) {
  const recoveryState = useConnectionStore((s) => s.recoveryState);
  const setRecoveryState = useConnectionStore((s) => s.setRecoveryState);
  const setRecoveryError = useConnectionStore((s) => s.setRecoveryError);
  const setLastEventSeq = useConnectionStore((s) => s.setLastEventSeq);
  const recoveryInProgressRef = useRef(false);

  // Effect 1: Track last event seq cursor for stream recovery
  useEffect(() => {
    const taskId = optimisticRun?.runId;
    if (!taskId || taskRunEvents.length === 0) return;
    let maxSeq = 0;
    for (const event of taskRunEvents) {
      if (event.event_seq != null && event.event_seq > maxSeq) {
        maxSeq = event.event_seq;
      }
    }
    if (maxSeq > 0) {
      setLastEventSeq(taskId, maxSeq);
    }
  }, [optimisticRun?.runId, setLastEventSeq, taskRunEvents]);

  // Effect 2: Stream recovery on WebSocket reconnection with exponential backoff
  useEffect(() => {
    const taskId = optimisticRun?.runId;

    if (justReconnected && taskId && !recoveryInProgressRef.current) {
      recoveryInProgressRef.current = true;
      setRecoveryState('recovering');
      setRecoveryError(null);

      let cancelled = false;
      const BASE_DELAY_MS = 1000;
      const MAX_DELAY_MS = 30000;
      const MAX_RECOVERY_RETRIES = 3;

      const attemptRecovery = async () => {
        for (let attempt = 0; attempt <= MAX_RECOVERY_RETRIES; attempt++) {
          if (cancelled) return;
          try {
            const recovered = await hubClient.listTaskRunEvents(taskId);
            if (!cancelled) {
              setTaskRunEvents((current) => mergeAgentRunEvents(current, recovered));
              setRecoveryState('idle');
              recoveryInProgressRef.current = false;
            }
            return;
          } catch (err) {
            if (cancelled) return;
            if (attempt >= MAX_RECOVERY_RETRIES) {
              const message = err instanceof Error ? err.message : 'Failed to recover stream events';
              setRecoveryError(message);
              setRecoveryState('failed');
              recoveryInProgressRef.current = false;
              return;
            }
            const rawDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
            const jitter = rawDelay * 0.2 * (Math.random() * 2 - 1);
            const delay = Math.round(Math.max(0, rawDelay + jitter));
            await new Promise<void>((resolve) => setTimeout(resolve, delay));
          }
        }
      };

      void attemptRecovery();

      return () => {
        cancelled = true;
        recoveryInProgressRef.current = false;
      };
    }

    // Reset when connection is lost
    if (!isConnected) {
      recoveryInProgressRef.current = false;
    }
  }, [justReconnected, isConnected, optimisticRun?.runId, hubClient, setRecoveryState, setRecoveryError]);

  // Effect 3: Clear recovery state when optimisticRun changes (new task started)
  useEffect(() => {
    if (!optimisticRun?.runId) {
      setRecoveryState('idle');
      setRecoveryError(null);
      recoveryInProgressRef.current = false;
    }
  }, [optimisticRun?.runId, setRecoveryState, setRecoveryError]);

  /**
   * Manual retry handler for the recovery-failed banner.
   * Re-runs the same exponential-backoff fetch loop.
   */
  const retryRecovery = useCallback(() => {
    const taskId = optimisticRun?.runId;
    if (!taskId) return;

    setRecoveryState('recovering');
    setRecoveryError(null);

    const BASE_DELAY_MS = 1000;
    const MAX_DELAY_MS = 30000;
    const MAX_RETRIES = 3;

    void (async () => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const recovered = await hubClient.listTaskRunEvents(taskId);
          setTaskRunEvents((current) => mergeAgentRunEvents(current, recovered));
          setRecoveryState('idle');
          setRecoveryError(null);
          return;
        } catch (err) {
          if (attempt >= MAX_RETRIES) {
            setRecoveryError(err instanceof Error ? err.message : 'Recovery failed');
            setRecoveryState('failed');
            return;
          }
          const rawDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
          const jitter = rawDelay * 0.2 * (Math.random() * 2 - 1);
          const delay = Math.round(Math.max(0, rawDelay + jitter));
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }
      }
    })();
  }, [optimisticRun?.runId, hubClient, setRecoveryState, setRecoveryError]);

  return { retryRecovery };
}
