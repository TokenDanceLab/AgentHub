import { useState } from 'react';
import { FileText, Globe, Image, Monitor, Download, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatComposerAttachmentSize as formatSize } from '../composer/attachments';
import { Button } from './Button';
import { SkeletonBar } from './SkeletonBar';
import styles from './ArtifactCard.module.css';
import { PREVIEW_SANDBOX_REMOTE } from './previewSandbox';
import { Tooltip } from './Tooltip';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';

export interface ArtifactCardProps {
  artifactId: string;
  artifactType: string;
  title: string;
  artifactUrl?: string | undefined;
  previewUrl?: string | undefined;
  size?: number | undefined;
  canApplyDiff?: boolean | undefined;
  diffApplied?: boolean | undefined;
}

const TYPE_ICON: Record<string, typeof FileText> = {
  file: FileText,
  page: Globe,
  image: Image,
  iframe: Monitor,
};

export function ArtifactCard({
  artifactId,
  artifactType,
  title,
  artifactUrl,
  previewUrl,
  size,
  canApplyDiff,
  diffApplied,
}: ArtifactCardProps) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const Icon = TYPE_ICON[artifactType] ?? FileText;
  const sizeLabel = formatSize(size);
  const url = artifactUrl;
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div className={styles.card} data-testid="artifact-card">
      <div className={styles.header}>
        <span className={styles.icon}>
          <Icon size={14} />
        </span>
        <span className={styles.typeLabel}>{artifactType}</span>
        <span className={styles.title}>{title}</span>
        {sizeLabel && <span className={styles.size}>{sizeLabel}</span>}
        <div className={styles.actions}>
          {canApplyDiff && !diffApplied && (
            <Tooltip label={t('ui.applyDiff', 'Apply diff')}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('agenthub:apply-artifact-diff', { detail: { artifactId } }),
                  )
                }
                aria-label={t('ui.applyDiff', 'Apply diff')}
              >
                <CheckCircle2 size={14} />
                <span className={styles.applyLabel}>Apply</span>
              </Button>
            </Tooltip>
          )}
          {diffApplied && (
            <span className={styles.appliedBadge}>
              <CheckCircle2 size={12} />
              Applied
            </span>
          )}
          {url && (
            <Tooltip label={t('ui.openArtifact', 'Open artifact')}>
              <a
                className={styles.iconAction}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('ui.openArtifact', 'Open artifact')}
              >
                <ExternalLink size={14} />
              </a>
            </Tooltip>
          )}
          {url && (
            <Tooltip label={t('ui.downloadArtifact', 'Download artifact')}>
              <a
                className={styles.iconAction}
                href={url}
                download
                aria-label={t('ui.downloadArtifact', 'Download artifact')}
              >
                <Download size={14} />
              </a>
            </Tooltip>
          )}
        </div>
      </div>
      {previewUrl && (
        <div className={styles.preview}>
          {artifactType === 'image' ? (
            <>
              {!imageLoaded && (
                <SkeletonBar variant="block" className={styles.previewSkeleton} />
              )}
              <img
                src={previewUrl}
                alt={title}
                className={styles.previewImage}
                loading="lazy"
                style={imageLoaded ? undefined : { display: 'none' }}
                onLoad={() => setImageLoaded(true)}
              />
            </>
          ) : (
            <iframe
              src={previewUrl}
              title={`Preview: ${title}`}
              className={styles.previewFrame}
              sandbox={PREVIEW_SANDBOX_REMOTE}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default ArtifactCard;
