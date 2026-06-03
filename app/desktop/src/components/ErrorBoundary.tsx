import { Component, type ReactNode } from 'react';
import {
  AlertTriangle,
  Clock,
  RefreshCw,
  RotateCcw,
  ServerCrash,
  WifiOff,
} from 'lucide-react';
import i18n from '@/i18n';
import styles from './ErrorBoundary.module.css';

// ── Props ──────────────────────────────────────────────

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// ── Error classification ──────────────────────────────

type ErrorKind = 'chunk' | 'network' | 'timeout' | 'crash' | 'unknown';

function classifyError(error: Error | null): ErrorKind {
  if (!error) return 'unknown';
  const msg = error.message || '';
  if (/ChunkLoadError|Loading chunk failed/i.test(msg)) return 'chunk';
  if (/network|fetch|Failed to fetch|NetworkError|ERR_NETWORK|ECONNREFUSED|connection\s*(lost|refused|reset)/i.test(msg)) return 'network';
  if (/timeout|ETIMEDOUT|timed\s*out|AbortError/i.test(msg)) return 'timeout';
  if (/agent|runtime|crash|SIGTERM|SIGKILL|process.*exit|spawn.*ENOENT/i.test(msg)) return 'crash';
  return 'unknown';
}

// ── ChunkLoadError auto-recovery ──────────────────────

const CHUNK_RELOAD_KEY = 'agenthub_chunk_reloads';
const CHUNK_RELOAD_WINDOW_MS = 20_000;
const CHUNK_RELOAD_MAX = 2;

function isChunkLoadError(error: Error): boolean {
  return /ChunkLoadError|Loading chunk failed/i.test(error.message);
}

function shouldChunkReload(): boolean {
  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    const now = Date.now();
    const entries: number[] = raw ? (JSON.parse(raw) as number[]) : [];
    const recent = entries.filter((t) => now - t < CHUNK_RELOAD_WINDOW_MS);
    return recent.length < CHUNK_RELOAD_MAX;
  } catch {
    return true;
  }
}

function recordChunkReload(): void {
  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    const now = Date.now();
    const entries: number[] = raw ? (JSON.parse(raw) as number[]) : [];
    const recent = entries.filter((t) => now - t < CHUNK_RELOAD_WINDOW_MS);
    recent.push(now);
    sessionStorage.setItem(CHUNK_RELOAD_KEY, JSON.stringify(recent));
  } catch {
    // sessionStorage may be unavailable; silently ignore
  }
}

// ── i18n helper with graceful degradation ─────────────

function t(key: string, fallback: string): string {
  try {
    if (i18n?.isInitialized) {
      return i18n.t(key, fallback);
    }
  } catch {
    // i18n not ready — fall through to hardcoded English
  }
  return fallback;
}

// ── Error kind configs ────────────────────────────────

interface ErrorConfig {
  icon: ReactNode;
  iconClass: string | undefined;
  titleKey: string;
  titleFallback: string;
  descKey: string;
  descFallback: string;
  primaryLabelKey: string;
  primaryLabelFallback: string;
}

const ERROR_CONFIGS: Record<ErrorKind, ErrorConfig> = {
  chunk: {
    icon: <RefreshCw size={28} aria-hidden="true" />,
    iconClass: styles.iconWrapChunk,
    titleKey: 'errorBoundary.chunkLoadTitle',
    titleFallback: 'Update Required',
    descKey: 'errorBoundary.chunkLoadDesc',
    descFallback: 'A new version of the app is available. Please reload to continue.',
    primaryLabelKey: 'errorBoundary.reload',
    primaryLabelFallback: 'Reload Page',
  },
  network: {
    icon: <WifiOff size={28} aria-hidden="true" />,
    iconClass: styles.iconWrapNetwork,
    titleKey: 'errorBoundary.networkTitle',
    titleFallback: 'Connection Lost',
    descKey: 'errorBoundary.networkDesc',
    descFallback: 'The connection to the server was lost. Check your network and try reconnecting.',
    primaryLabelKey: 'errorBoundary.reconnect',
    primaryLabelFallback: 'Reconnect',
  },
  timeout: {
    icon: <Clock size={28} aria-hidden="true" />,
    iconClass: styles.iconWrapTimeout,
    titleKey: 'errorBoundary.timeoutTitle',
    titleFallback: 'Service Timeout',
    descKey: 'errorBoundary.timeoutDesc',
    descFallback: 'The service took too long to respond. Please try again.',
    primaryLabelKey: 'errorBoundary.retry',
    primaryLabelFallback: 'Retry',
  },
  crash: {
    icon: <ServerCrash size={28} aria-hidden="true" />,
    iconClass: styles.iconWrapCrash,
    titleKey: 'errorBoundary.crashTitle',
    titleFallback: 'Agent Error',
    descKey: 'errorBoundary.crashDesc',
    descFallback: 'The agent runtime encountered an unexpected error. Restart the agent to continue.',
    primaryLabelKey: 'errorBoundary.restartAgent',
    primaryLabelFallback: 'Restart Agent',
  },
  unknown: {
    icon: <AlertTriangle size={28} aria-hidden="true" />,
    iconClass: styles.iconWrapUnknown,
    titleKey: 'errorBoundary.title',
    titleFallback: 'Something went wrong',
    descKey: 'errorBoundary.desc',
    descFallback: 'An unexpected error occurred while rendering this section.',
    primaryLabelKey: 'errorBoundary.reload',
    primaryLabelFallback: 'Reload Page',
  },
};

// ── Component ─────────────────────────────────────────

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] render error:', error, info);

    // Chunk load failures: auto-reload with rate limiting
    if (isChunkLoadError(error) && shouldChunkReload()) {
      recordChunkReload();
      window.location.reload();
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleReconnect = (): void => {
    this.setState({ hasError: false, error: null });
    // Trigger a navigation-level reconnect attempt
    window.dispatchEvent(new CustomEvent('agenthub:reconnect'));
  };

  handleRestartAgent = (): void => {
    this.setState({ hasError: false, error: null });
    // Signal the edge to restart the agent runtime
    window.dispatchEvent(new CustomEvent('agenthub:restart-agent'));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const error = this.state.error;
      const kind = classifyError(error);
      const config = ERROR_CONFIGS[kind];

      const title = t(config.titleKey, config.titleFallback);
      const description = t(config.descKey, config.descFallback);
      const primaryLabel = t(config.primaryLabelKey, config.primaryLabelFallback);
      const stackLabel = t('errorBoundary.stackTrace', 'Stack Trace');

      // Determine primary action handler
      let onPrimary: () => void;
      switch (kind) {
        case 'chunk':
        case 'unknown':
          onPrimary = this.handleReload;
          break;
        case 'network':
          onPrimary = this.handleReconnect;
          break;
        case 'timeout':
          onPrimary = this.handleRetry;
          break;
        case 'crash':
          onPrimary = this.handleRestartAgent;
          break;
      }

      return (
        <div className={styles.container} role="alert">
          <div className={config.iconClass ?? styles.iconWrap}>
            {config.icon}
          </div>

          <h2 className={styles.title}>{title}</h2>
          <p className={styles.description}>{description}</p>

          <div className={styles.actions}>
            <button
              type="button"
              onClick={onPrimary}
              className={styles.btnPrimary}
            >
              {kind === 'network' && <RotateCcw size={14} aria-hidden="true" />}
              {kind === 'crash' && <ServerCrash size={14} aria-hidden="true" />}
              {primaryLabel}
            </button>

            {kind !== 'chunk' && (
              <button
                type="button"
                onClick={this.handleRetry}
                className={styles.btnSecondary}
              >
                {t('errorBoundary.retry', 'Retry')}
              </button>
            )}
          </div>

          {error?.stack && (
            <details className={styles.stackDetails}>
              <summary className={styles.stackSummary}>
                {stackLabel}
              </summary>
              <pre className={styles.stackPre}>
                {error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
