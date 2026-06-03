import { type FC, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Clock, ShieldAlert, AlertTriangle } from 'lucide-react';
import type { TeamApprovalState, TeamConflictState } from '@/api/hubClient';

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

function statusStyle(status: string): React.CSSProperties {
  switch (status.toLowerCase()) {
    case 'pending':
    case 'requested':
    case 'waiting':
    case 'waiting_for_approval':
      return { color: '#f59e0b', backgroundColor: '#fef3c7' };
    case 'approved':
    case 'allowed':
    case 'resolved':
      return { color: '#10b981', backgroundColor: '#d1fae5' };
    case 'denied':
    case 'rejected':
      return { color: '#ef4444', backgroundColor: '#fee2e2' };
    default:
      return { color: '#6b7280', backgroundColor: '#f3f4f6' };
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
      <div style={{ padding: 16, color: 'var(--muted-foreground)', fontSize: 13 }}>
        {t('teamRun.loading', 'Loading approvals...')}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16, color: 'var(--color-danger, #e53e3e)', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!hasItems) {
    return (
      <div style={{ padding: 16, color: 'var(--muted-foreground)', fontSize: 13 }}>
        {t('teamRun.noApprovals', 'No pending approvals or conflicts.')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Reason input shared across decisions */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          placeholder={t('teamRun.reasonPlaceholder', 'Reason (optional)...')}
          value={reasonInput}
          onChange={(e) => setReasonInput(e.target.value)}
          style={{
            flex: 1,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-subtle, #e5e7eb)',
            fontSize: 12,
            backgroundColor: 'var(--surface-default, #fff)',
            color: 'var(--foreground)',
            outline: 'none',
          }}
        />
      </div>

      {pendingApprovals.map((approval) => {
        const isDeciding = decidingIds.has(approval.approval_id);
        const memberLabel = approval.member_id && memberNames?.[approval.member_id]
          ? memberNames[approval.member_id]
          : undefined;

        return (
          <div
            key={approval.approval_id}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle, #e5e7eb)',
              backgroundColor: 'var(--surface-raised, #f9fafb)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldAlert size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
                {t('teamRun.approvalRequest', 'Approval: {{tool}}', {
                  tool: approval.tool_name || t('teamRun.unknownTool', 'unknown tool'),
                })}
              </span>
              <span
                style={{
                  ...statusStyle(approval.status),
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 9999,
                }}
              >
                <Clock size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                {t('teamRun.status.pending', 'Pending')}
              </span>
            </div>

            {memberLabel && (
              <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                {t('teamRun.requestedBy', 'Requested by {{member}}', { member: memberLabel })}
              </div>
            )}

            {approval.reason && (
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', fontStyle: 'italic' }}>
                {approval.reason}
              </div>
            )}

            {approval.created_at && (
              <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                {timeAgo(approval.created_at)}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={isDeciding}
                onClick={() => setConfirmAction({
                    approvalId: approval.approval_id,
                    decision: 'deny',
                    toolLabel: approval.tool_name || t('teamRun.unknownTool', 'unknown tool'),
                  })}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--color-danger-border, #fca5a5)',
                  backgroundColor: 'var(--color-danger-bg, #fef2f2)',
                  color: 'var(--color-danger, #dc2626)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: isDeciding ? 'not-allowed' : 'pointer',
                  opacity: isDeciding ? 0.5 : 1,
                }}
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
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--color-success-border, #86efac)',
                  backgroundColor: 'var(--color-success-bg, #f0fdf4)',
                  color: 'var(--color-success, #16a34a)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: isDeciding ? 'not-allowed' : 'pointer',
                  opacity: isDeciding ? 0.5 : 1,
                }}
              >
                <Check size={14} /> {t('teamRun.approve', 'Approve')}
              </button>
            </div>
          </div>
        );
      })}

      {pendingConflicts.map((conflict) => (
        <div
          key={conflict.conflict_id}
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle, #e5e7eb)',
            backgroundColor: 'var(--surface-raised, #f9fafb)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
              {t('teamRun.conflictOn', 'Conflict: {{path}}', { path: conflict.path })}
            </span>
            <span
              style={{
                ...statusStyle(conflict.status),
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 9999,
              }}
            >
              {conflict.status}
            </span>
          </div>

          {conflict.agent_task_ids && conflict.agent_task_ids.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
              {t('teamRun.conflictSources', '{{count}} conflicting source(s)', {
                count: conflict.agent_task_ids.length,
              })}
            </div>
          )}

          {conflict.first_seen_at && (
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
              {t('teamRun.firstSeen', 'First seen {{time}}', { time: timeAgo(conflict.first_seen_at) })}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => onResolveConflict(conflict.conflict_id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '5px 12px',
                borderRadius: 6,
                border: '1px solid #86efac',
                backgroundColor: '#f0fdf4',
                color: '#16a34a',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Check size={14} /> {t('teamRun.resolveConflict', 'Resolve')}
            </button>
          </div>
        </div>
      ))}
      {confirmAction && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--overlay, rgba(0,0,0,0.4))',
            zIndex: 1000,
          }}
          onClick={() => setConfirmAction(null)}
          role="dialog"
          aria-label={t('teamRun.confirmTitle', 'Confirm decision')}
        >
          <div
            style={{
              backgroundColor: 'var(--surface-default, #fff)',
              border: '1px solid var(--border-subtle, #e5e7eb)',
              borderRadius: 8,
              padding: 20,
              minWidth: 320,
              maxWidth: 420,
              boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: 'var(--foreground)' }}>
              {confirmAction.decision === 'approve'
                ? t('teamRun.confirmApprove', 'Confirm approval')
                : t('teamRun.confirmDeny', 'Confirm denial')}
            </h4>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted-foreground)' }}>
              {confirmAction.decision === 'approve'
                ? t('teamRun.confirmApproveDesc', 'Approve "{{tool}}"?', { tool: confirmAction.toolLabel })
                : t('teamRun.confirmDenyDesc', 'Deny "{{tool}}"?', { tool: confirmAction.toolLabel })}
            </p>
            {reasonInput && (
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted-foreground)' }}>
                {t('teamRun.reasonLabel', 'Reason')}: {reasonInput}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle, #e5e7eb)',
                  backgroundColor: 'var(--surface-raised, #f9fafb)',
                  color: 'var(--foreground)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
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
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor:
                    confirmAction.decision === 'approve'
                      ? 'var(--color-success, #16a34a)'
                      : 'var(--color-danger, #dc2626)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
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
