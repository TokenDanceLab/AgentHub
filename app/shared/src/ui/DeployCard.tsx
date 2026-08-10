import { ExternalLink, Eye, Rocket, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import { Button } from './Button';
import { SkeletonBar } from './SkeletonBar';
import styles from './DeployCard.module.css';

export interface DeployCardProps {
  deployId?: string | undefined;
  status?: 'pending' | 'ready' | 'building' | 'deploying' | 'deployed' | 'failed' | undefined;
  statusMessage?: string | undefined;
  url?: string | undefined;
  /** Called when the user clicks the deploy button. */
  onDeploy?: (() => void) | undefined;
}

const STATUS_ICON: Record<string, typeof Rocket> = {
  pending: Rocket,
  building: Loader2,
  deploying: Loader2,
  deployed: CheckCircle2,
  failed: XCircle,
};

const STATUS_LABEL_KEY: Record<string, string> = {
  pending: 'deploy.status.pending',
  ready: 'deploy.status.ready',
  building: 'deploy.status.building',
  deploying: 'deploy.status.deploying',
  deployed: 'deploy.status.deployed',
  failed: 'deploy.status.failed',
};

export function DeployCard({
  status,
  statusMessage,
  url,
  onDeploy,
}: DeployCardProps) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const resolvedStatus = status ?? 'pending';
  const StatusIcon = STATUS_ICON[resolvedStatus] ?? Rocket;
  const statusKey = STATUS_LABEL_KEY[resolvedStatus];
  const label = statusKey ? t(statusKey) : resolvedStatus;
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
              <Button
                variant="secondary"
                size="sm"
                type="button"
                aria-label={t('deploy.action.preview')}
              >
                <Eye size={13} />
                <span>{t('deploy.action.preview')}</span>
              </Button>
            )}
            <a
              className={styles.openBtn}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('deploy.action.open')}
            >
              <ExternalLink size={13} />
              <span>{t('deploy.action.open')}</span>
            </a>
          </div>
        </div>
      )}

      {!url && isSpinning && (
        <div className={styles.urlBox}>
          <SkeletonBar height="1.5em" className={styles.skeleton} />
        </div>
      )}

      {!url && !isSpinning && onDeploy && (
        <div className={styles.urlBox}>
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={onDeploy}
          >
            <Rocket size={13} />
            <span>{t('deploy.action.deployToPublic')}</span>
          </Button>
        </div>
      )}
    </div>
  );
}

export default DeployCard;
