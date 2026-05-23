import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Circle, Wifi, WifiOff } from 'lucide-react';
import type { HealthResponse } from '@shared/types';
import { fetchHealth } from '@/api/edgeClient';
import { HEALTH_POLL_MS } from '@/config';
import styles from './StatusBar.module.css';

interface Props {
  online: boolean;
  health: HealthResponse | null;
  isConnected: boolean;
  error: string | null;
}

const LATENCY_GREEN = 50; // ms
const LATENCY_YELLOW = 200; // ms

export default function StatusBar({ online, health, isConnected, error }: Props) {
  const { t } = useTranslation();
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorCount, setErrorCount] = useState(0);
  const prevErrorRef = useRef<string | null>(null);

  // Measure Edge latency by timing health endpoint round-trips
  useEffect(() => {
    let active = true;

    const measure = async () => {
      const start = performance.now();
      try {
        await fetchHealth();
        if (active) setLatencyMs(Math.round(performance.now() - start));
      } catch {
        if (active) setLatencyMs(null);
      }
    };

    measure();
    const id = setInterval(measure, HEALTH_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Track error occurrences (increment when error string changes to non-null)
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      setErrorCount((c) => c + 1);
    }
    prevErrorRef.current = error;
  }, [error]);

  const clearErrors = useCallback(() => setErrorCount(0), []);

  const latencyClass =
    latencyMs == null
      ? styles.latencyNone
      : latencyMs < LATENCY_GREEN
        ? styles.latencyGood
        : latencyMs < LATENCY_YELLOW
          ? styles.latencyWarn
          : styles.latencyBad;

  const isReconnecting = !isConnected;

  return (
    <div className={styles.bar} role="status" aria-atomic="true">
      <Circle
        size={8}
        fill="currentColor"
        className={isReconnecting ? styles.pulse : undefined}
        style={{ color: online ? 'var(--color-success)' : 'var(--color-danger)' }}
        aria-hidden="true"
        data-testid={online ? 'status-dot-online' : 'status-dot-offline'}
      />
      <span>
        {online
          ? t('status.online', {
              version: health?.version ?? 'v1',
              edgeId: health?.edgeId ?? '?',
            })
          : t('status.offline')}
      </span>
      {latencyMs != null && (
        <span
          className={`${styles.latency} ${latencyClass}`}
          aria-label={`Latency ${latencyMs}ms`}
        >
          {latencyMs}ms
        </span>
      )}
      <span className={styles.spacer} />
      {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
      <span
        className={styles.wsStatus}
        aria-label={isConnected ? t('status.wsConnected') : t('status.wsDisconnected')}
      >
        {isConnected ? t('status.wsConnected') : t('status.wsDisconnected')}
      </span>
      {errorCount > 0 && (
        <span
          className={styles.errorBadge}
          role="status"
          aria-label={`${errorCount} error${errorCount > 1 ? 's' : ''}`}
          onClick={clearErrors}
          title={error ?? 'Click to dismiss'}
        >
          {errorCount > 99 ? '99+' : errorCount}
        </span>
      )}
    </div>
  );
}
