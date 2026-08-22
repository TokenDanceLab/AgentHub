import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getAgentActivityStore,
  type AgentActivitySnapshot,
  type AgentActivityStatus,
} from '../transcript/agentActivity';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import styles from './AgentStreamingBar.module.css';

// ── Status icons ──────────────────────────────────────────────────────────

const STATUS_ICON: Record<AgentActivityStatus, string> = {
  dispatching: '\u{1F504}',
  thinking: '\u{1F4AD}',
  streaming: '\u{2728}',
  done: '\u{2705}',
  failed: '\u{274C}',
};

const STATUS_LABEL_KEY: Record<AgentActivityStatus, string> = {
  dispatching: 'agentStreaming.status.dispatching',
  thinking: 'agentStreaming.status.thinking',
  streaming: 'agentStreaming.status.streaming',
  done: 'agentStreaming.status.done',
  failed: 'agentStreaming.status.failed',
};

// ── Store binding ─────────────────────────────────────────────────────────

const emptySnapshot: AgentActivitySnapshot = { activeAgents: [] };

function subscribe(cb: () => void): () => void {
  return getAgentActivityStore().subscribe(cb);
}

function getSnapshot(): AgentActivitySnapshot {
  return getAgentActivityStore().getSnapshot();
}

function getServerSnapshot(): AgentActivitySnapshot {
  return emptySnapshot;
}

// ── Component ─────────────────────────────────────────────────────────────

export interface AgentStreamingBarProps {
  /** Optional extra class name for the root element. */
  className?: string | undefined;
}

/**
 * Displays a compact bar of active agent statuses in the Overview panel.
 * Hidden when no agents are active. Uses `useSyncExternalStore` for reactivity.
 */
export function AgentStreamingBar({ className }: AgentStreamingBarProps): React.ReactElement | null {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const agents = snapshot.activeAgents;
  if (!agents || agents.length === 0) return null;

  const activeCount = agents.filter((a) => a.status !== 'done' && a.status !== 'failed').length;
  if (activeCount === 0 && agents.every((a) => a.status === 'done' || a.status === 'failed')) {
    // All agents finished — still show briefly (auto-removal handled by store timers).
    if (agents.length === 0) return null;
  }

  // No real progress percentage exists for agent runs, so surface the one
  // quantitative signal we do have: the number of tool calls.
  const totalToolCalls = agents.reduce((sum, a) => sum + (a.toolCalls ?? 0), 0);
  const toolCallsLabel = totalToolCalls > 0 ? ` · ${t('agentStreaming.toolCalls', { count: totalToolCalls })}` : '';

  // A11y (#1823): role=status announces on every mutation, so tool-call
  // counters and status icons chattered the screen reader during a stream.
  // While any agent is running the region drops to aria-live="off" (the #11
  // transcript pattern); when the last agent finishes it returns to 'polite'
  // and the terminal state is announced at most once.
  const anyActive = agents.some((a) => isActive(a.status));

  return (
    <div
      className={`${styles.bar} ${className ?? ''}`}
      role="status"
      aria-live={anyActive ? 'off' : 'polite'}
      aria-busy={anyActive}
    >
      {agents.length === 1 ? (
        <div className={styles.agent}>
          <span className={`${styles.icon} ${isActive(agents[0]!.status) ? styles.iconPulse : ''}`} aria-hidden="true">{STATUS_ICON[agents[0]!.status]}</span>
          <span className={styles.name}>{agents[0]!.name}</span>
          <span className={`${styles.status} ${statusClassName(agents[0]!.status)}`}>
            {t(STATUS_LABEL_KEY[agents[0]!.status])}
            {toolCallsLabel}
          </span>
        </div>
      ) : (
        <div className={styles.agent}>
          <span className={`${styles.icon} ${styles.iconPulse}`} aria-hidden="true">{'\u{1F916}'}</span>
          <span className={styles.name}>{t('agentStreaming.multiAgent', { count: activeCount })}{toolCallsLabel}</span>
          <span className={styles.detail}>
            {agents.map((a) => STATUS_ICON[a.status]).join(' ')}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function statusClassName(status: AgentActivityStatus): string {
  switch (status) {
    case 'streaming': return styles.statusStreaming ?? '';
    case 'thinking': return styles.statusThinking ?? '';
    case 'dispatching': return styles.statusThinking ?? '';
    case 'done': return styles.statusDone ?? '';
    case 'failed': return styles.statusFailed ?? '';
  }
}

function isActive(status: AgentActivityStatus): boolean {
  return status === 'dispatching' || status === 'thinking' || status === 'streaming';
}
