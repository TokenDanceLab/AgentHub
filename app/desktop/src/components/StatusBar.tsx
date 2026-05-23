import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Circle, Wifi, WifiOff, Sun, Moon } from 'lucide-react';
import type { HealthResponse } from '@shared/types';
import { fetchHealth } from '@/api/edgeClient';
import { HEALTH_POLL_MS } from '@/config';
import { useTheme } from '@/contexts/ThemeContext';
import styles from './StatusBar.module.css';

interface Props {
  online: boolean;
  health: HealthResponse | null;
  isConnected: boolean;
  error: string | null;
  projectPath?: string;
}

const LATENCY_GREEN = 50; // ms
const LATENCY_YELLOW = 200; // ms

export default memo(function StatusBar({ online, health, isConnected, error, projectPath }: Props) {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorCount, setErrorCount] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const prevErrorRef = useRef<string | null>(null);
  const prevOnlineRef = useRef(online);

  // Track reconnecting state: true when online goes from true→false
  useEffect(() => {
    const wasOnline = prevOnlineRef.current;
    if (online) {
      setIsReconnecting(false);
    } else if (wasOnline) {
      setIsReconnecting(true);
    }
    prevOnlineRef.current = online;
  }, [online]);

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
      <span className={isReconnecting ? styles.reconnecting : undefined}>
        {online
          ? t('status.online', {
              version: health?.version ?? 'v1',
              edgeId: health?.edgeId ?? '?',
            })
          : isReconnecting
            ? t('status.reconnecting')
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
      {projectPath && (
        <>
          <span className={styles.separator} aria-hidden="true" />
          <span className={styles.projectPath} title={projectPath}>
            {projectPath}
          </span>
        </>
      )}
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
      <button
        className={styles.themeBtn}
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? t('theme.light') : t('theme.dark')}
        title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
        type="button"
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </div>
  );
});
