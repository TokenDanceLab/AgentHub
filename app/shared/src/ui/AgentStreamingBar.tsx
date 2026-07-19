import React, { useSyncExternalStore } from 'react';
import {
  getAgentActivityStore,
  type AgentActivitySnapshot,
  type AgentActivityStatus,
} from '../transcript/agentActivity';
import styles from './AgentStreamingBar.module.css';

// ── Status icons ──────────────────────────────────────────────────────────

const STATUS_ICON: Record<AgentActivityStatus, string> = {
  dispatching: '\u{1F504}',
  thinking: '\u{1F4AD}',
  streaming: '\u{2728}',
  done: '\u{2705}',
  failed: '\u{274C}',
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
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const agents = snapshot.activeAgents;
  if (!agents || agents.length === 0) return null;

  const activeCount = agents.filter((a) => a.status !== 'done' && a.status !== 'failed').length;
  if (activeCount === 0 && agents.every((a) => a.status === 'done' || a.status === 'failed')) {
    // All agents finished — still show briefly (auto-removal handled by store timers).
    if (agents.length === 0) return null;
  }

  return (
    <div className={`${styles.bar} ${className ?? ''}`} role="status" aria-live="polite">
      {agents.length === 1 ? (
        <div className={styles.agent}>
          <span className={`${styles.icon} ${isActive(agents[0]!.status) ? styles.iconPulse : ''}`} aria-hidden="true">{STATUS_ICON[agents[0]!.status]}</span>
          <span className={styles.name}>{agents[0]!.name}</span>
          <span className={`${styles.status} ${statusClassName(agents[0]!.status)}`}>
            {statusLabel(agents[0]!.status)}
          </span>
        </div>
      ) : (
        <div className={styles.agent}>
          <span className={`${styles.icon} ${styles.iconPulse}`} aria-hidden="true">{'\u{1F916}'}</span>
          <span className={styles.name}>{activeCount} 个 Agent 运行中</span>
          <span className={styles.detail}>
            {agents.map((a) => STATUS_ICON[a.status]).join(' ')}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function statusLabel(status: AgentActivityStatus): string {
  switch (status) {
    case 'dispatching': return '调度中…';
    case 'thinking': return '思考中…';
    case 'streaming': return '输出中…';
    case 'done': return '完成';
    case 'failed': return '失败';
  }
}

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
