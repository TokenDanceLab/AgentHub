import React from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';
import { connectionStatusLabel, type ConnectionStatusKind } from './GlobalRail';
import type { MainchainSummary } from './mainchain';
import type { WorkbenchAttentionCounts } from './workbenchAttentionModel';
import { formatTokenCount } from './pages/TokenUsagePage';

/**
 * Workbench global bottom status bar (#1994, UX F5).
 *
 * Global segments render on every rail page: Hub connection state, the F6
 * attention chips (running / awaiting approval) and the F14 live usage chip.
 * Conversation-scoped segments (evidence chain nodes + evidence export)
 * render only when the frame enables `showConversationChain` (chat page with
 * showMainchainStatus), so demo surfaces keep the chain and real surfaces
 * stay honest. The bar renders nothing when it has no real data to show.
 */
export interface MainchainStatusStripProps {
  /** Hub WebSocket state; absent keeps the connection chip hidden. */
  connectionStatus?: ConnectionStatusKind | undefined;
  /** Conversation evidence chain (frame-gated, chat page only). */
  summary?: MainchainSummary | undefined;
  onExportEvidence?: (() => void) | undefined;
  showConversationChain?: boolean | undefined;
  /**
   * Global attention counts (F6). Absent when the shell provides no
   * run/approval inventory — the chips stay hidden.
   */
  attention?: WorkbenchAttentionCounts | undefined;
  /** Click-through for the running chip (Tasks page queue). */
  onOpenRunningQueue?: (() => void) | undefined;
  /** Click-through for the awaiting-approval chip (frame-owned, #1994). */
  onOpenApprovalQueue?: (() => void) | undefined;
  /**
   * Live total of recorded usage-board tokens (#1990, F14). Absent when the
   * shell has no Hub usage data — the chip stays honestly hidden then.
   */
  usageTokenTotal?: number | undefined;
  /** Click-through for the usage chip (opens the Usage page). */
  onOpenUsage?: (() => void) | undefined;
}

export function MainchainStatusStrip({
  attention,
  connectionStatus,
  onExportEvidence,
  onOpenApprovalQueue,
  onOpenRunningQueue,
  onOpenUsage,
  showConversationChain,
  summary,
  usageTokenTotal,
}: MainchainStatusStripProps): React.ReactElement | null {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const runningCount = attention?.runningCount ?? 0;
  const awaitingApprovalCount = attention?.awaitingApprovalCount ?? 0;
  // Fallback-mode scope marker: counts then cover the ACTIVE conversation
  // only, and the chips must say so instead of implying fleet-wide totals.
  const scopeHint = attention?.activeConversationOnly
    ? t('sharedWorkbench:attention.scopeActiveConversation')
    : undefined;
  const showChain = Boolean(showConversationChain && summary && onExportEvidence);
  const hasChips = runningCount > 0 || awaitingApprovalCount > 0 || usageTokenTotal !== undefined;
  if (!connectionStatus && !showChain && !hasChips) return null;
  const connectionLabel = connectionStatus
    ? t('connectionDot.label', { status: connectionStatusLabel(connectionStatus, t) })
    : undefined;
  return (
    // A11y (#10): the bar's node states/labels change at runtime — a
    // polite live region announces the changes without stealing focus.
    <section className={styles.workbenchStatusBar} aria-label={t('aria.mainChainStatus')} aria-live="polite">
      {connectionStatus && connectionLabel && (
        <span className={styles.statusBarConnection} title={connectionLabel}>
          <span className={styles.connectionDot} data-status={connectionStatus} aria-hidden="true" />
          <span className={styles.statusBarConnectionLabel}>{connectionLabel}</span>
        </span>
      )}
      {showChain && summary && (
        <div className={styles.mainchainTrack} role="list">
          {summary.nodes.map((n) => (
            <div className={styles.mainchainNode} data-state={n.state} key={n.id} role="listitem">
              <span className={styles.mainchainDot} aria-hidden="true" />
              <span className={styles.mainchainCopy}><strong>{n.label}</strong><em>{n.detail}</em></span>
            </div>
          ))}
        </div>
      )}
      {hasChips && (
        <div className={styles.mainchainAttention} data-attention>
          {runningCount > 0 && renderAttentionChip({
            handler: onOpenRunningQueue,
            kind: 'running',
            label: t('sharedWorkbench:attention.running', { count: String(runningCount) }),
            ariaLabel: chipAria(
              t('sharedWorkbench:attention.running', { count: String(runningCount) }),
              t('sharedWorkbench:attention.openTaskQueue'),
              scopeHint,
            ),
          })}
          {awaitingApprovalCount > 0 && renderAttentionChip({
            handler: onOpenApprovalQueue,
            kind: 'awaiting',
            label: t('sharedWorkbench:attention.awaitingApproval', { count: String(awaitingApprovalCount) }),
            ariaLabel: chipAria(
              t('sharedWorkbench:attention.awaitingApproval', { count: String(awaitingApprovalCount) }),
              t('sharedWorkbench:attention.openApprovalQueue'),
              scopeHint,
            ),
          })}
          {/* #1990 (UX F14): live usage total from the usage board's real
              token_usage_total counters; click through to the Usage page.
              Absent total = chip hidden (honest, never a fake 0). */}
          {usageTokenTotal !== undefined && renderAttentionChip({
            handler: onOpenUsage,
            kind: 'usage',
            label: t('sharedWorkbench:usage.chip', { count: formatTokenCount(usageTokenTotal) }),
            ariaLabel: chipAria(
              t('sharedWorkbench:usage.chip', { count: formatTokenCount(usageTokenTotal) }),
              t('sharedWorkbench:usage.openBoard'),
              undefined,
            ),
          })}
        </div>
      )}
      {showChain && summary && (
        <button type="button" className={styles.mainchainExport} disabled={!summary.exportEnabled}
          onClick={onExportEvidence} title={summary.exportDetail}>{summary.exportLabel}</button>
      )}
    </section>
  );
}

/** aria/title for an attention chip: label · queue action · scope hint. */
function chipAria(label: string, action: string, scopeHint: string | undefined): string {
  return scopeHint ? `${label} · ${action} · ${scopeHint}` : `${label} · ${action}`;
}

interface AttentionChipSpec {
  handler: (() => void) | undefined;
  kind: 'running' | 'awaiting' | 'usage';
  label: string;
  ariaLabel: string;
}

/**
 * Interactive chip when the shell wired a click-through; plain status text
 * otherwise (demo surfaces keep the count visible without a fake target).
 */
function renderAttentionChip(spec: AttentionChipSpec): React.ReactElement {
  const dot = <span className={styles.mainchainAttentionDot} aria-hidden="true" />;
  if (!spec.handler) {
    return (
      <span aria-label={spec.ariaLabel} className={styles.mainchainAttentionChip}
        data-attention-kind={spec.kind} key={spec.kind} title={spec.ariaLabel}>
        {dot}
        {spec.label}
      </span>
    );
  }
  const handler = spec.handler;
  return (
    <button aria-label={spec.ariaLabel} className={styles.mainchainAttentionChip}
      data-attention-kind={spec.kind} key={spec.kind} onClick={() => handler()}
      title={spec.ariaLabel} type="button">
      {dot}
      {spec.label}
    </button>
  );
}
