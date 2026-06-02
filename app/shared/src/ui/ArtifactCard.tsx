import { FileText, Globe, Image, Monitor, Download, ExternalLink, CheckCircle2 } from 'lucide-react';
import styles from './ArtifactCard.module.css';

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

function formatSize(bytes: number | undefined): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ArtifactCard({
  artifactId,
  artifactType,
  title,
  artifactUrl,
  previewUrl,
  size,
  canApplyDiff,
  diffApplied,
}: ArtifactCardProps) {
  const Icon = TYPE_ICON[artifactType] ?? FileText;
  const sizeLabel = formatSize(size);
  const url = artifactUrl;

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
            <button
              className={styles.applyBtn}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('agenthub:apply-artifact-diff', { detail: { artifactId } }),
                )
              }
              title="Apply diff"
              aria-label="Apply diff"
            >
              <CheckCircle2 size={14} />
              <span className={styles.applyLabel}>Apply</span>
            </button>
          )}
          {diffApplied && (
            <span className={styles.appliedBadge}>
              <CheckCircle2 size={12} />
              Applied
            </span>
          )}
          {url && (
            <a
              className={styles.actionBtn}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open artifact"
              aria-label="Open artifact"
            >
              <ExternalLink size={14} />
            </a>
          )}
          {url && (
            <a
              className={styles.actionBtn}
              href={url}
              download
              title="Download artifact"
              aria-label="Download artifact"
            >
              <Download size={14} />
            </a>
          )}
        </div>
      </div>
      {previewUrl && (
        <div className={styles.preview}>
          {artifactType === 'image' ? (
            <img
              src={previewUrl}
              alt={title}
              className={styles.previewImage}
              loading="lazy"
            />
          ) : (
            <iframe
              src={previewUrl}
              title={`Preview: ${title}`}
              className={styles.previewFrame}
              sandbox="allow-scripts allow-same-origin"
            />
          )}
        </div>
      )}
    </div>
  );
}
