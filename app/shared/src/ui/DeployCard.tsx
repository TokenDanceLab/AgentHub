import { Rocket, ExternalLink, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import styles from './DeployCard.module.css';

export interface DeployCardProps {
  deployId?: string | undefined;
  status?: string | undefined;
  statusMessage?: string | undefined;
  url?: string | undefined;
}

const STATUS_ICON: Record<string, typeof Rocket> = {
  pending: Rocket,
  building: Loader2,
  deploying: Loader2,
  deployed: CheckCircle2,
  failed: XCircle,
};

const STATUS_CLASS: Record<string, string | undefined> = {
  pending: styles.statusPending,
  building: styles.statusBuilding,
  deploying: styles.statusDeploying,
  deployed: styles.statusDeployed,
  failed: styles.statusFailed,
};

export default function DeployCard({
  deployId,
  status,
  statusMessage,
  url,
}: DeployCardProps) {
  const resolvedStatus = status ?? 'pending';
  const StatusIcon = STATUS_ICON[resolvedStatus] ?? Rocket;
  const statusClass = STATUS_CLASS[resolvedStatus] ?? '';
  const isSpinning = resolvedStatus === 'building' || resolvedStatus === 'deploying';

  return (
    <div className={styles.card} data-testid="deploy-card">
      <div className={styles.header}>
        <span className={`${styles.statusIcon} ${statusClass} ${isSpinning ? styles.spin : ''}`}>
          <StatusIcon size={16} />
        </span>
        <div className={styles.info}>
          <span className={styles.label}>Deploy</span>
          <span className={`${styles.statusLabel} ${statusClass}`}>{resolvedStatus}</span>
        </div>
        {statusMessage && <span className={styles.message}>{statusMessage}</span>}
        {url && (
          <a
            className={styles.actionBtn}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open deployment"
            aria-label="Open deployment"
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      {deployId && (
        <div className={styles.footer}>
          <code className={styles.deployId}>{deployId}</code>
        </div>
      )}
    </div>
  );
}
