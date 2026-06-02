import { FileText, Globe, Image, Monitor, Download, ExternalLink, CheckCircle2 } from 'lucide-react';
import type { MessageBlock } from './ChatView.types';
import styles from './ArtifactCard.module.css';

interface Props {
  block: Extract<MessageBlock, { kind: 'artifact' }>;
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

export default function ArtifactCard({ block }: Props) {
  const Icon = TYPE_ICON[block.artifactType] ?? FileText;
  const sizeLabel = formatSize(block.size);
  const artifactUrl = block.artifactUrl ?? block.url;

  return (
    <div className={styles.card} data-testid="artifact-card">
      <div className={styles.header}>
        <span className={styles.icon}>
          <Icon size={14} />
        </span>
        <span className={styles.typeLabel}>{block.artifactType}</span>
        <span className={styles.title}>{block.title}</span>
        {sizeLabel && <span className={styles.size}>{sizeLabel}</span>}
        <div className={styles.actions}>
          {block.canApplyDiff && !block.diffApplied && (
            <button
              className={styles.applyBtn}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('agenthub:apply-artifact-diff', { detail: { artifactId: block.artifactId } }),
                )
              }
              title="Apply diff"
              aria-label="Apply diff"
            >
              <CheckCircle2 size={14} />
              <span className={styles.applyLabel}>Apply</span>
            </button>
          )}
          {block.diffApplied && (
            <span className={styles.appliedBadge}>
              <CheckCircle2 size={12} />
              Applied
            </span>
          )}
          {artifactUrl && (
            <a
              className={styles.actionBtn}
              href={artifactUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open artifact"
              aria-label="Open artifact"
            >
              <ExternalLink size={14} />
            </a>
          )}
          {artifactUrl && (
            <a
              className={styles.actionBtn}
              href={artifactUrl}
              download
              title="Download artifact"
              aria-label="Download artifact"
            >
              <Download size={14} />
            </a>
          )}
        </div>
      </div>
      {block.previewUrl && (
        <div className={styles.preview}>
          {block.artifactType === 'image' ? (
            <img
              src={block.previewUrl}
              alt={block.title}
              className={styles.previewImage}
              loading="lazy"
            />
          ) : (
            <iframe
              src={block.previewUrl}
              title={`Preview: ${block.title}`}
              className={styles.previewFrame}
              sandbox="allow-scripts allow-same-origin"
            />
          )}
        </div>
      )}
    </div>
  );
}
