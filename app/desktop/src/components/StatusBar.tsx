import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef, useCallback, memo } from 'react';
<<<<<<< HEAD
import { Circle, Wifi, WifiOff, Sun, Moon, LogIn } from 'lucide-react';
=======
import { Wifi, WifiOff, Sun, Moon } from 'lucide-react';
>>>>>>> origin/dev/trump
import type { HealthResponse } from '@shared/types';
import { StatusBadge } from '@shared/components';
import { useTheme } from '@/contexts/ThemeContext';
import { useHubStore } from '@/stores/hubStore';
import styles from './StatusBar.module.css';

interface Props {
  online: boolean;
  health: HealthResponse | null;
  isConnected: boolean;
  error: string | null;
  projectPath?: string;
  /** QW-3: WebSocket ping-pong round-trip latency in ms, polled from eventClient. */
  wsLatency?: number | null;
  /** Whether authenticated against Hub server. */
  hubAuthenticated?: boolean;
}

const LATENCY_GREEN = 50; // ms
const LATENCY_YELLOW = 200; // ms

export default memo(function StatusBar({ online, health, isConnected, error, projectPath, wsLatency, hubAuthenticated }: Props) {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
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

  // Track error occurrences (increment when error string changes to non-null)
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      setErrorCount((c) => c + 1);
    }
    prevErrorRef.current = error;
  }, [error]);

  const clearErrors = useCallback(() => setErrorCount(0), []);

  const latencyMs = wsLatency ?? null;

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
      <StatusBadge
        status={online ? 'online' : isReconnecting ? 'running' : 'offline'}
      />
      {online && health && (
        <span className={styles.edgeInfo}>
          {health.version ?? 'v1'} / {health.edgeId ?? '?'}
        </span>
      )}
      {isReconnecting && (
        <span className={styles.reconnecting}>{t('status.reconnecting')}</span>
      )}
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
      {hubAuthenticated != null && (
        <>
          <span className={styles.separator} aria-hidden="true" />
          <button
            className={styles.hubBtn}
            onClick={() => {
              if (!hubAuthenticated) {
                useHubStore.getState().setShowAuthModal(true);
              }
            }}
            type="button"
            title={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}
            aria-label={hubAuthenticated ? t('status.hubConnected') : t('status.hubClickToLogin')}
          >
            <Circle
              size={6}
              fill="currentColor"
              style={{ color: hubAuthenticated ? 'var(--color-success)' : 'var(--muted-foreground)' }}
              aria-hidden="true"
            />
            <span className={styles.wsStatus}>
              {hubAuthenticated ? t('status.hubConnected') : t('status.hubDisconnected')}
            </span>
            {!hubAuthenticated && <LogIn size={12} />}
          </button>
        </>
      )}
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
