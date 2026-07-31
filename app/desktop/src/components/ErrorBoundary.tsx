import { type ReactNode } from 'react';
import { ServerCrash, WifiOff, RotateCcw } from 'lucide-react';
import { ErrorBoundary as SharedErrorBoundary } from '@shared/ui';
import type { ErrorBoundaryExtension } from '@shared/ui';
import styles from './ErrorBoundary.module.css';

/**
 * Desktop-platform ErrorBoundary wrapper.
 *
 * Extends the shared base 4 kinds (chunk/network/timeout/unknown) with:
 * - crash: agent runtime errors — restart agent
 * - network override: use Reconnect (dispatch agenthub:reconnect) instead of Reload Page
 *
 * Stack traces are always visible (no DEV guard needed in desktop context).
 */
export default function ErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <SharedErrorBoundary extensions={EXTENSIONS}>
      {children}
    </SharedErrorBoundary>
  );
}

// ── Extension handlers ─────────────────────────────────

function handleReconnect(): void {
  window.dispatchEvent(new CustomEvent('agenthub:reconnect'));
}

function handleRestartAgent(): void {
  window.dispatchEvent(new CustomEvent('agenthub:restart-agent'));
}

// ── Extensions ─────────────────────────────────────────

const EXTENSIONS: ErrorBoundaryExtension[] = [
  {
    matches: (error: Error) =>
      /agent|runtime|crash|SIGTERM|SIGKILL|process.*exit|spawn.*ENOENT/i.test(
        error.message || '',
      ),
    config: {
      icon: <ServerCrash size={28} aria-hidden="true" />,
      iconClass: styles.iconWrapCrash,
      titleKey: 'errorBoundary.crashTitle',
      titleFallback: 'Agent Error',
      descKey: 'errorBoundary.crashDesc',
      descFallback:
        'The agent runtime encountered an unexpected error. Restart the agent to continue.',
      primaryLabelKey: 'errorBoundary.restartAgent',
      primaryLabelFallback: 'Restart Agent',
      primaryIcon: <ServerCrash size={14} aria-hidden="true" />,
    },
    onPrimary: handleRestartAgent,
  },
  {
    matches: (error: Error) =>
      /network|fetch|Failed to fetch|NetworkError|ERR_NETWORK|ECONNREFUSED|connection\s*(lost|refused|reset)/i.test(
        error.message || '',
      ),
    config: {
      icon: <WifiOff size={28} aria-hidden="true" />,
      iconClass: styles.iconWrapNetwork,
      titleKey: 'errorBoundary.networkTitle',
      titleFallback: 'Connection Lost',
      descKey: 'errorBoundary.networkDesc',
      descFallback:
        'The connection to the server was lost. Check your network and try reconnecting.',
      primaryLabelKey: 'errorBoundary.reconnect',
      primaryLabelFallback: 'Reconnect',
      primaryIcon: <RotateCcw size={14} aria-hidden="true" />,
    },
    onPrimary: handleReconnect,
  },
];
