import React from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';
import type { MainchainSummary } from './mainchain';
import type { WorkbenchAttentionCounts } from './workbenchAttentionModel';
import { formatTokenCount } from './pages/TokenUsagePage';

export interface MainchainStatusStripProps {
  summary: MainchainSummary;
  onExportEvidence: () => void;
  /**
   * Global attention counts (F6). Absent when the shell provides no
   * run/approval inventory — the chips stay hidden.
   */
  attention?: WorkbenchAttentionCounts | undefined;
  /** Click-through for the running chip (Tasks page queue). */
  onOpenRunningQueue?: (() => void) | undefined;
  /** Click-through for the awaiting-approval chip (approval summary). */
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
  onExportEvidence,
  onOpenApprovalQueue,
  onOpenRunningQueue,
  onOpenUsage,
  summary,
  usageTokenTotal,
}: MainchainStatusStripProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const runningCount = attention?.runningCount ?? 0;
  const awaitingApprovalCount = attention?.awaitingApprovalCount ?? 0;
  // Fallback-mode scope marker: counts then cover the ACTIVE conversation
  // only, and the chips must say so instead of implying fleet-wide totals.
  const scopeHint = attention?.activeConversationOnly
    ? t('sharedWorkbench:attention.scopeActiveConversation')
    : undefined;
  return (
    // A11y (#10): the strip's node states/labels change at runtime — a
    // polite live region announces the changes without stealing focus.
    <section className={styles.mainchainStrip} aria-label={t('aria.mainChainStatus')} aria-live="polite">
      <div className={styles.mainchainTrack} role="list">
        {summary.nodes.map((n) => (
          <div className={styles.mainchainNode} data-state={n.state} key={n.id} role="listitem">
            <span className={styles.mainchainDot} aria-hidden="true" />
            <span className={styles.mainchainCopy}><strong>{n.label}</strong><em>{n.detail}</em></span>
          </div>
        ))}
      </div>
      {(runningCount > 0 || awaitingApprovalCount > 0 || usageTokenTotal !== undefined) && (
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
      <button type="button" className={styles.mainchainExport} disabled={!summary.exportEnabled}
        onClick={onExportEvidence} title={summary.exportDetail}>{summary.exportLabel}</button>
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
