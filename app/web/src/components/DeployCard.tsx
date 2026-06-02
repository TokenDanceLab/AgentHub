import { Rocket, ExternalLink, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import type { MessageBlock } from './ChatView.types';
import styles from './DeployCard.module.css';

interface Props {
  block: Extract<MessageBlock, { kind: 'deploy_card' }>;
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

export default function DeployCard({ block }: Props) {
  const StatusIcon = STATUS_ICON[block.status] ?? Rocket;
  const statusClass = STATUS_CLASS[block.status] ?? '';
  const isSpinning = block.status === 'building' || block.status === 'deploying';

  return (
    <div className={styles.card} data-testid="deploy-card">
      <div className={styles.header}>
        <span className={`${styles.statusIcon} ${statusClass} ${isSpinning ? styles.spin : ''}`}>
          <StatusIcon size={16} />
        </span>
        <div className={styles.info}>
          <span className={styles.label}>Deploy</span>
          <span className={`${styles.statusLabel} ${statusClass}`}>{block.status}</span>
        </div>
        {block.statusMessage && <span className={styles.message}>{block.statusMessage}</span>}
        {block.url && (
          <a
            className={styles.actionBtn}
            href={block.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open deployment"
            aria-label="Open deployment"
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      {block.deployId && (
        <div className={styles.footer}>
          <code className={styles.deployId}>{block.deployId}</code>
        </div>
      )}
    </div>
  );
}
