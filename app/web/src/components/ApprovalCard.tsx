import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clock, Shield, User, Wrench, X } from 'lucide-react';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { useToastStore } from '@/stores/toastStore';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'timeout';

interface ApprovalCardProps {
  approvalId: string;
  agentName: string;
  toolName: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  timestamp: string;
  reason?: string | undefined;
  decidedBy?: string | undefined;
  decidedAt?: string | undefined;
  teamId?: string | undefined;
  runId?: string | undefined;
  agentTaskId?: string | undefined;
}

const cardStyle: CSSProperties = {
  display: 'grid',
  gap: '12px',
  margin: '10px 0',
  padding: '14px',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  background: 'var(--surface-raised)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
};

const metaStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  color: 'var(--muted-foreground)',
  fontSize: '12px',
};

const actionRowStyle: CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
};

function statusText(status: ApprovalStatus): string {
  return status === 'approved' ? 'approved' : status;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function ApprovalCard({
  approvalId,
  agentName,
  toolName,
  riskLevel,
  status,
  timestamp,
  reason,
  decidedBy,
  decidedAt,
  teamId,
  runId,
}: ApprovalCardProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const hubClient = useMemo(() => createHubClient({ getToken: getAccessToken }), []);
  const [localStatus, setLocalStatus] = useState(status);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canDecide = localStatus === 'pending' && teamId && runId;

  const decide = useCallback(
    async (decision: 'allow' | 'deny') => {
      if (!teamId || !runId) {
        return;
      }
      setIsSubmitting(true);
      try {
        await hubClient.decideTeamApproval(teamId, runId, approvalId, {
          decision,
          ...(decision === 'deny' ? { reason: t('approval.deniedByUser') } : {}),
        });
        setLocalStatus(decision === 'allow' ? 'approved' : 'denied');
        addToast({
          type: 'success',
          message: decision === 'allow' ? t('approval.approved') : t('approval.denied'),
        });
      } catch {
        addToast({ type: 'error', message: t('approval.decideError') });
      } finally {
        setIsSubmitting(false);
      }
    },
    [addToast, approvalId, hubClient, runId, t, teamId],
  );

  return (
    <section style={cardStyle} data-testid="approval-card" aria-label={t('approval.title')}>
      <header style={{ ...rowStyle, justifyContent: 'space-between' }}>
        <strong style={{ ...rowStyle, color: 'var(--foreground)' }}>
          <Shield size={16} />
          {t('approval.title')}
        </strong>
        <span style={metaStyle}>
          {riskLevel.toUpperCase()}
          {' / '}
          {statusText(localStatus)}
        </span>
      </header>

      <div style={rowStyle}>
        <span style={metaStyle}>
          <User size={13} />
          {agentName}
        </span>
        <span style={metaStyle}>
          <Wrench size={13} />
          {toolName}
        </span>
      </div>

      {reason ? <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>{reason}</p> : null}

      {localStatus !== 'pending' && decidedAt ? (
        <span style={metaStyle}>
          {localStatus === 'approved'
            ? t('approval.approvedBy', { name: decidedBy || t('approval.user') })
            : t('approval.deniedBy', { name: decidedBy || t('approval.user') })}
          {' · '}
          {formatTime(decidedAt)}
        </span>
      ) : null}

      {canDecide ? (
        <div style={actionRowStyle}>
          <button type="button" disabled={isSubmitting} onClick={() => decide('allow')}>
            <Check size={14} />
            <span>{t('approval.approve')}</span>
          </button>
          <button type="button" disabled={isSubmitting} onClick={() => decide('deny')}>
            <X size={14} />
            <span>{t('approval.deny')}</span>
          </button>
        </div>
      ) : null}

      <span style={metaStyle}>
        <Clock size={12} />
        {formatTime(timestamp)}
      </span>
    </section>
  );
}
