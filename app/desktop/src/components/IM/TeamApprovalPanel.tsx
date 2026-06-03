import { type FC, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Clock, ShieldAlert, AlertTriangle } from 'lucide-react';
import type { TeamApprovalState, TeamConflictState } from '@/api/hubClient';
import styles from './TeamApprovalPanel.module.css';

interface TeamApprovalPanelProps {
  approvals: TeamApprovalState[];
  conflicts: TeamConflictState[];
  loading?: boolean;
  error?: string | null;
  onApprove: (approvalId: string, reason?: string) => void;
  onDeny: (approvalId: string, reason?: string) => void;
  onResolveConflict: (conflictId: string) => void;
  decidingIds?: Set<string>;
  memberNames?: Record<string, string>;
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function badgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'pending':
    case 'requested':
    case 'waiting':
    case 'waiting_for_approval':
      return styles.badgePending!;
    case 'approved':
    case 'allowed':
    case 'resolved':
      return styles.badgeApproved!;
    case 'denied':
    case 'rejected':
      return styles.badgeDenied!;
    default:
      return styles.badgeDefault!;
  }
}

export const TeamApprovalPanel: FC<TeamApprovalPanelProps> = ({
  approvals,
  conflicts,
  loading,
  error,
  onApprove,
  onDeny,
  onResolveConflict,
  decidingIds = new Set(),
  memberNames,
}) => {
  const { t } = useTranslation();
  const [reasonInput, setReasonInput] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    approvalId: string;
    decision: 'approve' | 'deny';
    toolLabel: string;
  } | null>(null);

  const pendingApprovals = approvals.filter((a) =>
    ['pending', 'requested', 'waiting', 'waiting_for_approval'].includes(a.status.toLowerCase()),
  );
  const pendingConflicts = conflicts.filter((c) => c.status !== 'resolved');
  const hasItems = pendingApprovals.length > 0 || pendingConflicts.length > 0;

  const handleApprove = useCallback(
    (approvalId: string) => {
      onApprove(approvalId, reasonInput || undefined);
      setReasonInput('');
      setConfirmAction(null);
    },
    [onApprove, reasonInput],
  );

  const handleDeny = useCallback(
    (approvalId: string) => {
      onDeny(approvalId, reasonInput || undefined);
      setReasonInput('');
      setConfirmAction(null);
    },
    [onDeny, reasonInput],
  );

  if (loading) {
    return (
      <div className={styles.loading}>
        {t('teamRun.loading', 'Loading approvals...')}
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        {error}
      </div>
    );
  }

  if (!hasItems) {
    return (
      <div className={styles.empty}>
        {t('teamRun.noApprovals', 'No pending approvals or conflicts.')}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Reason input shared across decisions */}
      <div className={styles.reasonRow}>
        <input
          type="text"
          placeholder={t('teamRun.reasonPlaceholder', 'Reason (optional)...')}
          value={reasonInput}
          onChange={(e) => setReasonInput(e.target.value)}
          className={styles.reasonInput}
        />
      </div>

      {pendingApprovals.map((approval) => {
        const isDeciding = decidingIds.has(approval.approval_id);
        const memberLabel = approval.member_id && memberNames?.[approval.member_id]
          ? memberNames[approval.member_id]
          : undefined;

        return (
          <div key={approval.approval_id} className={styles.card}>
            <div className={styles.cardHeader}>
              <ShieldAlert size={16} className={styles.cardIconWarning} />
              <span className={styles.cardTitle}>
                {t('teamRun.approvalRequest', 'Approval: {{tool}}', {
                  tool: approval.tool_name || t('teamRun.unknownTool', 'unknown tool'),
                })}
              </span>
              <span className={`${styles.badge} ${badgeClass(approval.status)}`}>
                <Clock size={10} className={styles.badgeIcon} />
                {t('teamRun.status.pending', 'Pending')}
              </span>
            </div>

            {memberLabel && (
              <div className={styles.cardMeta}>
                {t('teamRun.requestedBy', 'Requested by {{member}}', { member: memberLabel })}
              </div>
            )}

            {approval.reason && (
              <div className={styles.cardMetaItalic}>
                {approval.reason}
              </div>
            )}

            {approval.created_at && (
              <div className={styles.cardMeta}>
                {timeAgo(approval.created_at)}
              </div>
            )}

            <div className={styles.cardActions}>
              <button
                type="button"
                disabled={isDeciding}
                onClick={() => setConfirmAction({
                    approvalId: approval.approval_id,
                    decision: 'deny',
                    toolLabel: approval.tool_name || t('teamRun.unknownTool', 'unknown tool'),
                  })}
                className={`${styles.actionBtn} ${styles.actionBtnDeny}`}
              >
                <X size={14} /> {t('teamRun.deny', 'Deny')}
              </button>
              <button
                type="button"
                disabled={isDeciding}
                onClick={() => setConfirmAction({
                    approvalId: approval.approval_id,
                    decision: 'approve',
                    toolLabel: approval.tool_name || t('teamRun.unknownTool', 'unknown tool'),
                  })}
                className={`${styles.actionBtn} ${styles.actionBtnApprove}`}
              >
                <Check size={14} /> {t('teamRun.approve', 'Approve')}
              </button>
            </div>
          </div>
        );
      })}

      {pendingConflicts.map((conflict) => (
        <div key={conflict.conflict_id} className={styles.card}>
          <div className={styles.cardHeader}>
            <AlertTriangle size={16} className={styles.cardIconWarning} />
            <span className={styles.cardTitle}>
              {t('teamRun.conflictOn', 'Conflict: {{path}}', { path: conflict.path })}
            </span>
            <span className={`${styles.badge} ${badgeClass(conflict.status)}`}>
              {conflict.status}
            </span>
          </div>

          {conflict.agent_task_ids && conflict.agent_task_ids.length > 0 && (
            <div className={styles.cardMeta}>
              {t('teamRun.conflictSources', '{{count}} conflicting source(s)', {
                count: conflict.agent_task_ids.length,
              })}
            </div>
          )}

          {conflict.first_seen_at && (
            <div className={styles.cardMeta}>
              {t('teamRun.firstSeen', 'First seen {{time}}', { time: timeAgo(conflict.first_seen_at) })}
            </div>
          )}

          <div className={styles.cardActions}>
            <button
              type="button"
              onClick={() => onResolveConflict(conflict.conflict_id)}
              className={styles.actionBtnResolve}
            >
              <Check size={14} /> {t('teamRun.resolveConflict', 'Resolve')}
            </button>
          </div>
        </div>
      ))}
      {confirmAction && (
        <div
          className={styles.overlay}
          onClick={() => setConfirmAction(null)}
          role="dialog"
          aria-label={t('teamRun.confirmTitle', 'Confirm decision')}
        >
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h4 className={styles.dialogTitle}>
              {confirmAction.decision === 'approve'
                ? t('teamRun.confirmApprove', 'Confirm approval')
                : t('teamRun.confirmDeny', 'Confirm denial')}
            </h4>
            <p className={styles.dialogBody}>
              {confirmAction.decision === 'approve'
                ? t('teamRun.confirmApproveDesc', 'Approve "{{tool}}"?', { tool: confirmAction.toolLabel })
                : t('teamRun.confirmDenyDesc', 'Deny "{{tool}}"?', { tool: confirmAction.toolLabel })}
            </p>
            {reasonInput && (
              <p className={styles.dialogReason}>
                {t('teamRun.reasonLabel', 'Reason')}: {reasonInput}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className={styles.dialogCancel}
              >
                {t('teamRun.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={() =>
                  confirmAction.decision === 'approve'
                    ? handleApprove(confirmAction.approvalId)
                    : handleDeny(confirmAction.approvalId)
                }
                className={`${styles.dialogConfirm} ${
                  confirmAction.decision === 'approve'
                    ? styles.dialogConfirmApprove
                    : styles.dialogConfirmDeny
                }`}
              >
                {confirmAction.decision === 'approve'
                  ? t('teamRun.confirm', 'Confirm')
                  : t('teamRun.confirm', 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
