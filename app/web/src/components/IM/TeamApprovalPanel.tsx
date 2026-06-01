import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Shield, X, AlertTriangle, Clock } from 'lucide-react';
import type { TeamApprovalState, TeamConflictState } from '@/api/hubClient';
import styles from './TeamApprovalPanel.module.css';

interface TeamApprovalPanelProps {
  approvals: TeamApprovalState[];
  conflicts: TeamConflictState[];
  loading: boolean;
  error: string | null;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
  onResolveConflict: (conflictId: string) => void;
  decidingIds: Set<string>;
  memberNames: Record<string, string>;
}

const DECIDED_STATUSES = new Set(['approved', 'denied', 'allow', 'deny', 'decided', 'resolved']);

function isPending(a: TeamApprovalState): boolean {
  const s = a.status.toLowerCase();
  return ['pending', 'requested', 'waiting', 'waiting_for_approval'].includes(s);
}

function formatReason(reason?: string): string {
  if (!reason) return '';
  return reason.length > 120 ? `${reason.slice(0, 120)}...` : reason;
}

export const TeamApprovalPanel = memo(function TeamApprovalPanel({
  approvals,
  conflicts,
  loading,
  error,
  onApprove,
  onDeny,
  onResolveConflict,
  decidingIds,
  memberNames,
}: TeamApprovalPanelProps) {
  const { t } = useTranslation();

  if (loading && approvals.length === 0 && conflicts.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.hint}>{t('teamRun.loading', 'Loading...')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  const pendingApprovals = approvals.filter(isPending);
  const decidedApprovals = approvals.filter((a) => !isPending(a));
  const hasAnyData = approvals.length > 0 || conflicts.length > 0;

  if (!hasAnyData) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <Shield size={32} className={styles.emptyIcon} />
          <span>{t('teamRun.noApprovals', 'No approvals required for this run.')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Pending approvals */}
      {pendingApprovals.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Clock size={14} className={styles.sectionIconPending} />
            <span className={styles.sectionTitle}>{t('teamRun.pendingApprovals', 'Pending approvals')}</span>
            <span className={styles.sectionCount}>{pendingApprovals.length}</span>
          </div>
          {pendingApprovals.map((a) => (
            <div key={a.approval_id} className={styles.approvalCard}>
              <div className={styles.approvalInfo}>
                <div className={styles.approvalTool}>
                  {a.tool_name ? `Tool: ${a.tool_name}` : t('teamRun.approvalRequest', 'Approval request')}
                  {a.tool_use_id && (
                    <span className={styles.toolUseId}>{a.tool_use_id.slice(0, 12)}</span>
                  )}
                </div>
                {a.reason && (
                  <div className={styles.approvalReason}>{formatReason(a.reason)}</div>
                )}
                <div className={styles.approvalMeta}>
                  {a.member_id && memberNames[a.member_id] && (
                    <span className={styles.requester}>
                      {t('teamRun.requestedBy', 'By {{name}}', { name: memberNames[a.member_id] ?? a.member_id.slice(0, 8) })}
                    </span>
                  )}
                  {a.created_at && (
                    <span className={styles.timestamp}>
                      {new Date(a.created_at).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.approvalActions}>
                <button
                  type="button"
                  className={styles.approveBtn}
                  onClick={() => onApprove(a.approval_id)}
                  disabled={decidingIds.has(a.approval_id)}
                >
                  <Check size={14} />
                  {decidingIds.has(a.approval_id) ? '...' : t('teamRun.approve', 'Approve')}
                </button>
                <button
                  type="button"
                  className={styles.denyBtn}
                  onClick={() => onDeny(a.approval_id)}
                  disabled={decidingIds.has(a.approval_id)}
                >
                  <X size={14} />
                  {decidingIds.has(a.approval_id) ? '...' : t('teamRun.deny', 'Deny')}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Decided approvals */}
      {decidedApprovals.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Check size={14} className={styles.sectionIconDone} />
            <span className={styles.sectionTitle}>{t('teamRun.decidedApprovals', 'Decided')}</span>
            <span className={styles.sectionCount}>{decidedApprovals.length}</span>
          </div>
          {decidedApprovals.map((a) => (
            <div key={a.approval_id} className={styles.decidedCard}>
              <div className={styles.decidedStatus}>
                {a.status === 'approved' || a.status === 'allow' ? (
                  <Check size={12} className={styles.approvedIcon} />
                ) : (
                  <X size={12} className={styles.deniedIcon} />
                )}
                <span>{a.status}</span>
              </div>
              <span className={styles.decidedTool}>{a.tool_name || a.approval_id.slice(0, 8)}</span>
              {a.decided_by && (
                <span className={styles.decidedBy}>
                  {memberNames[a.decided_by] ?? a.decided_by.slice(0, 8)}
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <AlertTriangle size={14} className={styles.sectionIconConflict} />
            <span className={styles.sectionTitle}>{t('teamRun.conflicts', 'Conflicts')}</span>
            <span className={styles.sectionCount}>{conflicts.length}</span>
          </div>
          {conflicts.map((c) => (
            <div key={c.conflict_id} className={styles.conflictCard}>
              <div className={styles.conflictHeader}>
                <AlertTriangle size={14} className={styles.conflictIcon} />
                <span className={styles.conflictPath}>{c.path}</span>
                <span className={c.status === 'resolved' ? styles.resolvedBadge : styles.pendingBadge}>
                  {c.status}
                </span>
              </div>
              {c.agent_task_ids && c.agent_task_ids.length > 0 && (
                <div className={styles.conflictTasks}>
                  {c.agent_task_ids.slice(0, 3).map((tid) => (
                    <span key={tid} className={styles.conflictTaskId}>{tid.slice(0, 8)}</span>
                  ))}
                  {c.agent_task_ids.length > 3 && (
                    <span className={styles.moreTasks}>+{c.agent_task_ids.length - 3}</span>
                  )}
                </div>
              )}
              {c.resolution && (
                <div className={styles.conflictResolution}>{c.resolution}</div>
              )}
              {c.status !== 'resolved' && (
                <button
                  type="button"
                  className={styles.resolveBtn}
                  onClick={() => onResolveConflict(c.conflict_id)}
                >
                  {t('teamRun.resolve', 'Resolve')}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
});

export default TeamApprovalPanel;
