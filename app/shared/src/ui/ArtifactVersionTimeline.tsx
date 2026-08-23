import { useState } from 'react';
import { GitCommitHorizontal, ChevronDown, RotateCcw, FileDiff } from 'lucide-react';
import { Button } from './Button';
import styles from './ArtifactVersionTimeline.module.css';

export interface ArtifactVersion {
  version: number;
  artifactId: string;
  runId: string;
  createdAt: string;
  summary?: string | undefined;
}

export interface ArtifactVersionTimelineProps {
  artifactId: string;
  artifactTitle: string;
  versions: ArtifactVersion[];
  onRevert?: ((versionNumber: number) => void) | undefined;
  onCompare?: ((fromVersion: number, toVersion: number) => void) | undefined;
  className?: string | undefined;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

/**
 * Artifact version history browse/compare/revert timeline.
 * 消费方：暂无应用内直接消费点，经 ui barrel 导出（#1820）。
 */
export function ArtifactVersionTimeline({
  artifactId: _artifactId,
  artifactTitle,
  versions,
  onRevert,
  onCompare,
  className,
}: ArtifactVersionTimelineProps) {
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);

  if (versions.length === 0) return null;

  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const latest = sorted[0]?.version ?? 0;

  return (
    <div className={`${styles.root} ${className ?? ''}`} data-testid="artifact-version-timeline">
      <div className={styles.header}>
        <GitCommitHorizontal size={14} className={styles.headerIcon} />
        <span className={styles.headerTitle}>{artifactTitle}</span>
        <span className={styles.headerCount}>{versions.length} versions</span>
      </div>
      <div className={styles.timeline}>
        {sorted.map((v, i) => (
          <div
            key={v.version}
            className={`${styles.versionNode} ${v.version === latest ? styles.versionLatest : ''}`}
            data-testid={`version-${v.version}`}
          >
            <div className={styles.rail}>
              <div className={`${styles.dot} ${v.version === latest ? styles.dotLatest : ''}`} />
              {i < sorted.length - 1 && <div className={styles.connector} />}
            </div>
            <div className={styles.content}>
              <button type="button"
                className={styles.versionHeader}
                onClick={() => setExpandedVersion((prev) => prev === v.version ? null : v.version)}
              >
                <span className={styles.versionLabel}>v{v.version}</span>
                {v.version === latest && <span className={styles.latestBadge}>current</span>}
                <span className={styles.versionTime}>{formatTime(v.createdAt)}</span>
                <ChevronDown
                  size={12}
                  className={`${styles.expandChevron} ${expandedVersion === v.version ? styles.expandChevronOpen : ''}`}
                />
              </button>
              {v.summary && (
                <p className={styles.summary}>{v.summary}</p>
              )}
              {expandedVersion === v.version && (
                <div className={styles.actions}>
                  {v.version < latest && onCompare && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onCompare(v.version, latest)}
                      type="button"
                    >
                      <FileDiff size={14} />
                      <span>Compare with current</span>
                    </Button>
                  )}
                  {onRevert && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onRevert(v.version)}
                      type="button"
                    >
                      <RotateCcw size={14} />
                      <span>Revert to v{v.version}</span>
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
