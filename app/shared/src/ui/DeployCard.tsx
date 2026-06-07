import { ExternalLink, Eye, Rocket, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import styles from './DeployCard.module.css';

export interface DeployCardProps {
  deployId?: string | undefined;
  status?: 'pending' | 'building' | 'deploying' | 'deployed' | 'failed' | undefined;
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

const STATUS_LABEL: Record<string, string> = {
  pending: '待部署',
  building: '构建中',
  deploying: '部署中',
  deployed: '已就绪',
  failed: '部署失败',
};

export default function DeployCard({
  status,
  statusMessage,
  url,
}: DeployCardProps) {
  const resolvedStatus = status ?? 'pending';
  const StatusIcon = STATUS_ICON[resolvedStatus] ?? Rocket;
  const label = STATUS_LABEL[resolvedStatus] ?? resolvedStatus;
  const isSpinning = resolvedStatus === 'building' || resolvedStatus === 'deploying';
  const isSuccess = resolvedStatus === 'deployed';
  const isFailed = resolvedStatus === 'failed';

  return (
    <div className={styles.card} data-testid="deploy-card">
      <div className={styles.head}>
        <span
          className={`${styles.badge} ${isSuccess ? styles.badgeSuccess : isFailed ? styles.badgeDanger : styles.badgePrimary}`}
        >
          <span className={styles.badgeDot} />
          <StatusIcon size={12} className={isSpinning ? styles.spin : ''} />
          {label}
        </span>
        <span className={styles.title}>
          Deploy{statusMessage ? ` · ${statusMessage}` : ''}
        </span>
      </div>

      {url && (
        <div className={styles.urlBox}>
          <span className={styles.url}>{url}</span>
          <div className={styles.actions}>
            {isSuccess && (
              <button
                className={styles.previewBtn}
                type="button"
                aria-label="预览"
              >
                <Eye size={13} />
                <span>预览</span>
              </button>
            )}
            <a
              className={styles.openBtn}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="打开"
            >
              <ExternalLink size={13} />
              <span>打开</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
