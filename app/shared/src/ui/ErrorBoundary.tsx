import { Component, type ReactNode } from 'react';
import {
  AlertTriangle,
  Clock,
  RefreshCw,
  RotateCcw,
  WifiOff,
} from 'lucide-react';
import { getI18n } from 'react-i18next';
import styles from './ErrorBoundary.module.css';

// ── Types ──────────────────────────────────────────────

interface Props {
  children: ReactNode;
  /** Platform-specific extensions: checked before base kinds */
  extensions?: ErrorBoundaryExtension[];
  /** Show stack trace details (default true) */
  showStack?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export interface ErrorConfig {
  icon: ReactNode;
  iconClass: string | undefined;
  titleKey: string;
  titleFallback: string;
  descKey: string;
  descFallback: string;
  primaryLabelKey: string;
  primaryLabelFallback: string;
  /** Optional icon shown beside the primary button label */
  primaryIcon?: ReactNode;
}

export interface ErrorBoundaryExtension {
  /** Returns true if this extension handles the given error */
  matches: (error: Error) => boolean;
  config: ErrorConfig;
  onPrimary: () => void;
}

// ── Base error classification ──────────────────────────

type BaseErrorKind = 'chunk' | 'network' | 'timeout' | 'unknown';

function classifyBaseKind(error: Error | null): BaseErrorKind {
  if (!error) return 'unknown';
  const msg = error.message || '';
  if (/ChunkLoadError|Loading chunk failed/i.test(msg)) return 'chunk';
  if (/network|fetch|Failed to fetch|NetworkError|ERR_NETWORK|ECONNREFUSED|connection\s*(lost|refused|reset)/i.test(msg)) return 'network';
  if (/timeout|ETIMEDOUT|timed\s*out|AbortError/i.test(msg)) return 'timeout';
  return 'unknown';
}

// ── ChunkLoadError auto-recovery ───────────────────────

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

// ── i18n helper with graceful degradation ──────────────

function t(key: string, fallback: string): string {
  try {
    const i18n = getI18n();
    if (i18n?.isInitialized) {
      return i18n.t(key, fallback);
    }
  } catch {
    // i18n not ready — fall through to hardcoded English
  }
  return fallback;
}

// ── Base error kind configs ─────────────────────────────

const BASE_ERROR_CONFIGS: Record<BaseErrorKind, ErrorConfig> = {
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
    descFallback: 'The connection to the server was lost. Check your network and try reloading.',
    primaryLabelKey: 'errorBoundary.reload',
    primaryLabelFallback: 'Reload Page',
    primaryIcon: <RotateCcw size={14} aria-hidden="true" />,
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

// ── Resolution ─────────────────────────────────────────

interface ResolvedError {
  config: ErrorConfig;
  onPrimary: () => void;
}

function resolveError(
  error: Error | null,
  extensions: ErrorBoundaryExtension[] | undefined,
  handleRetry: () => void,
  handleReload: () => void,
): ResolvedError {
  // 1. Check extensions first
  if (error && extensions) {
    for (const ext of extensions) {
      if (ext.matches(error)) {
        return { config: ext.config, onPrimary: ext.onPrimary };
      }
    }
  }

  // 2. Fall back to base kinds
  const kind = classifyBaseKind(error);
  const config = BASE_ERROR_CONFIGS[kind];

  let onPrimary: () => void;
  switch (kind) {
    case 'timeout':
      onPrimary = handleRetry;
      break;
    case 'chunk':
    case 'network':
    case 'unknown':
    default:
      onPrimary = handleReload;
      break;
  }

  return { config, onPrimary };
}

// ── Component ──────────────────────────────────────────

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
      try {
        window.location.reload();
      } catch {
        // reload may throw in test environments (jsdom); silently ignore
      }
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { error } = this.state;
      const { extensions, showStack = true } = this.props;

      const { config, onPrimary } = resolveError(
        error,
        extensions,
        this.handleRetry,
        this.handleReload,
      );

      const title = t(config.titleKey, config.titleFallback);
      const description = t(config.descKey, config.descFallback);
      const primaryLabel = t(config.primaryLabelKey, config.primaryLabelFallback);
      const stackLabel = t('errorBoundary.stackTrace', 'Stack Trace');

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
              {config.primaryIcon}
              {primaryLabel}
            </button>

            {!(error && isChunkLoadError(error)) && (
              <button
                type="button"
                onClick={this.handleRetry}
                className={styles.btnSecondary}
              >
                {t('errorBoundary.retry', 'Retry')}
              </button>
            )}
          </div>

          {showStack && error?.stack && (
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
