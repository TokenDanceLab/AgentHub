import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import i18n from '@/i18n';

// ── Props ──────────────────────────────────────────────

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
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

  render(): ReactNode {
    if (this.state.hasError) {
      const error = this.state.error;
      const isChunk = !!(error && isChunkLoadError(error));

      const title = isChunk
        ? t('errorBoundary.chunkLoadTitle', 'Update Required')
        : t('errorBoundary.title', 'Something went wrong');

      const description = isChunk
        ? t(
            'errorBoundary.chunkLoadDesc',
            'A new version of the app is available. Please reload to continue.',
          )
        : t(
            'errorBoundary.desc',
            'An unexpected error occurred while rendering this section.',
          );

      const retryLabel = t('errorBoundary.retry', 'Retry');
      const reloadLabel = t('errorBoundary.reload', 'Reload Page');
      const stackLabel = t('errorBoundary.stackTrace', 'Stack Trace');

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 24px',
            textAlign: 'center',
            color: 'var(--foreground)',
          }}
          role="alert"
        >
          <AlertTriangle
            size={40}
            style={{ color: 'var(--warning, #f59e0b)', marginBottom: 16 }}
            aria-hidden="true"
          />

          <h2
            style={{
              margin: '0 0 8px',
              fontSize: 'var(--font-size-lg, 18px)',
              fontWeight: 600,
            }}
          >
            {title}
          </h2>

          <p
            style={{
              margin: '0 0 24px',
              fontSize: 'var(--font-size-sm, 14px)',
              color: 'var(--muted-foreground)',
              maxWidth: 480,
              lineHeight: 1.5,
            }}
          >
            {description}
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            {isChunk ? (
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  padding: '8px 20px',
                  border: 'none',
                  borderRadius: 'var(--radius-md, 6px)',
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                  fontSize: 'var(--font-size-sm, 14px)',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {reloadLabel}
              </button>
            ) : (
              <button
                type="button"
                onClick={this.handleRetry}
                style={{
                  padding: '8px 20px',
                  border: 'none',
                  borderRadius: 'var(--radius-md, 6px)',
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                  fontSize: 'var(--font-size-sm, 14px)',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {retryLabel}
              </button>
            )}
          </div>

          {error?.stack && (
            <details
              style={{
                width: '100%',
                maxWidth: 560,
                textAlign: 'left',
                fontSize: 'var(--font-size-xs, 12px)',
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  color: 'var(--muted-foreground)',
                  marginBottom: 8,
                  userSelect: 'none',
                }}
              >
                {stackLabel}
              </summary>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  background: 'var(--muted)',
                  borderRadius: 'var(--radius-md, 6px)',
                  overflow: 'auto',
                  maxHeight: 200,
                  fontSize: 'var(--font-size-xs, 12px)',
                  lineHeight: 1.4,
                  color: 'var(--muted-foreground)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
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
