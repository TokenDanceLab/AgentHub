import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Check, X, Clock, AlertTriangle, User, Wrench } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import styles from './ApprovalCard.module.css';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'timeout';

interface ApprovalCardProps {
  approvalId: string;
  agentName: string;
  toolName: string;
  riskLevel: RiskLevel;
  reason?: string | undefined;
  status: ApprovalStatus;
  timestamp: string;
  decidedBy?: string | undefined;
  decidedAt?: string | undefined;
  teamId?: string | undefined;
  runId?: string | undefined;
  agentTaskId?: string | undefined;
}

function riskLabel(level: RiskLevel, t: (key: string) => string): string {
  const map: Record<RiskLevel, string> = {
    low: t('approval.risk.low'),
    medium: t('approval.risk.medium'),
    high: t('approval.risk.high'),
    critical: t('approval.risk.critical'),
  };
  return map[level];
}

function statusLabel(status: ApprovalStatus, t: (key: string) => string): string {
  const map: Record<ApprovalStatus, string> = {
    pending: t('approval.status.pending'),
    approved: t('approval.status.approved'),
    denied: t('approval.status.denied'),
    timeout: t('approval.status.timeout'),
  };
  return map[status];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ApprovalCard(props: ApprovalCardProps) {
  const {
    approvalId,
    agentName,
    toolName,
    riskLevel,
    reason,
    status,
    timestamp,
    decidedBy,
    decidedAt,
    teamId,
    runId,
  } = props;

  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  const hubClient = useMemo(() => createHubClient({ getToken: getAccessToken }), []);

  const [deciding, setDeciding] = useState(false);
  const [localStatus, setLocalStatus] = useState<ApprovalStatus>(status);

  const canDecide = localStatus === 'pending' && teamId && runId;

  const handleDecide = useCallback(
    async (decision: 'approve' | 'deny') => {
      if (!teamId || !runId) return;

      setDeciding(true);
      try {
        // 1) Fire custom event for any legacy listeners
        window.dispatchEvent(
          new CustomEvent('agenthub:decide-approval', {
            detail: {
              teamId,
              runId,
              approvalId,
              decision,
              reason: decision === 'deny' ? t('approval.deniedByUser') : undefined,
            },
          }),
        );

        // 2) Call the Hub API directly
        const mappedDecision = decision === 'approve' ? 'allow' as const : 'deny' as const;
        const reason = decision === 'deny' ? t('approval.deniedByUser') : undefined;
        await hubClient.decideTeamApproval(teamId, runId, approvalId, {
          decision: mappedDecision,
          ...(reason ? { reason } : {}),
        });

        setLocalStatus(decision === 'approve' ? 'approved' : 'denied');
        addToast({
          type: 'success',
          message: decision === 'approve' ? t('approval.approved') : t('approval.denied'),
        });
      } catch {
        addToast({
          type: 'error',
          message: t('approval.decideError'),
        });
      } finally {
        setDeciding(false);
      }
    },
    [teamId, runId, approvalId, hubClient, addToast, t],
  );

  const riskClass = styles[`risk${riskLevel.charAt(0).toUpperCase()}${riskLevel.slice(1)}`] ?? '';

  return (
    <div
      className={`${styles.card} ${styles[`status${localStatus.charAt(0).toUpperCase()}${localStatus.slice(1)}`] ?? ''}`}
      data-testid="approval-card"
    >
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.icon}>
          <Shield size={16} />
        </span>
        <span className={styles.title}>{t('approval.title')}</span>
        <span className={`${styles.riskBadge} ${riskClass}`}>
          {riskLabel(riskLevel, t)}
        </span>
        <span className={`${styles.statusBadge} ${styles[`status${localStatus.charAt(0).toUpperCase()}${localStatus.slice(1)}`] ?? ''}`}>
          {statusLabel(localStatus, t)}
        </span>
      </div>

      {/* Agent + Tool info */}
      <div className={styles.info}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>
            <User size={13} />
            <span>{t('approval.agent')}</span>
          </span>
          <span className={styles.infoValue}>{agentName}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>
            <Wrench size={13} />
            <span>{t('approval.tool')}</span>
          </span>
          <span className={styles.infoValue}>{toolName}</span>
        </div>
        {reason && (
          <div className={styles.reason}>
            <span className={styles.infoLabel}>{t('approval.reason')}</span>
            <p className={styles.reasonText}>{reason}</p>
          </div>
        )}
      </div>

      {/* Decisions */}
      {localStatus !== 'pending' && decidedAt && (
        <div className={styles.decision}>
          <span className={styles.decisionLabel}>
            {localStatus === 'approved'
              ? t('approval.approvedBy', { name: decidedBy || t('approval.user') })
              : t('approval.deniedBy', { name: decidedBy || t('approval.user') })}
          </span>
          <span className={styles.decisionTime}>{formatDate(decidedAt)}</span>
        </div>
      )}

      {/* Actions */}
      {canDecide && (
        <div className={styles.actions}>
          <button
            className={styles.approveBtn}
            onClick={() => handleDecide('approve')}
            disabled={deciding}
            type="button"
            title={t('approval.approve')}
          >
            <Check size={14} />
            <span>{t('approval.approve')}</span>
          </button>
          <button
            className={styles.denyBtn}
            onClick={() => handleDecide('deny')}
            disabled={deciding}
            type="button"
            title={t('approval.deny')}
          >
            <X size={14} />
            <span>{t('approval.deny')}</span>
          </button>
        </div>
      )}

      {/* Timestamp */}
      <div className={styles.footer}>
        <span className={styles.footerTime}>
          <Clock size={12} />
          {formatTime(timestamp)}
        </span>
        {localStatus === 'pending' && (
          <AlertTriangle size={12} className={styles.pendingIcon} />
        )}
      </div>
    </div>
  );
}
