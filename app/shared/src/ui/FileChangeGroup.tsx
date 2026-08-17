import { useState } from 'react';
import { FileText, ChevronDown, ExternalLink, Eye } from 'lucide-react';
import styles from './FileChangeGroup.module.css';
import { Tooltip } from './Tooltip';

export interface FileChangeItem {
  fileName: string;
  fullPath: string;
  insertions: number;
  deletions: number;
}

export interface FileChangeGroupProps {
  title: string;
  files: FileChangeItem[];
  defaultExpanded?: boolean | undefined;
  onFileClick?: ((file: FileChangeItem) => void) | undefined;
  onDiffClick?: ((file: FileChangeItem) => void) | undefined;
  className?: string | undefined;
}

export function FileChangeGroup({
  title,
  files,
  defaultExpanded = true,
  onFileClick,
  onDiffClick,
  className,
}: FileChangeGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (files.length === 0) return null;

  return (
    <div className={`${styles.group} ${className ?? ''}`} data-testid="file-change-group">
      <button type="button"
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.dot} />
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>{files.length} files</span>
        <ChevronDown
          size={14}
          className={`${styles.chevron} ${expanded ? styles.chevronDown : ''}`}
        />
      </button>
      {expanded && (
        <div className={styles.body}>
          {files.map((file, i) => (
            <div
              key={file.fullPath + i}
              className={styles.fileRow}
              onClick={() => onFileClick?.(file)}
              role={onFileClick ? 'button' : undefined}
              tabIndex={onFileClick ? 0 : undefined}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && onFileClick) onFileClick(file);
              }}
            >
              <div className={styles.fileInfo}>
                <FileText size={14} className={styles.fileIcon} />
                <span className={styles.fileName}>{file.fileName}</span>
                <span className={styles.filePath}>{file.fullPath}</span>
              </div>
              <div className={styles.fileStats}>
                {file.insertions > 0 && (
                  <span className={styles.additions}>+{file.insertions}</span>
                )}
                {file.deletions > 0 && (
                  <span className={styles.deletions}>-{file.deletions}</span>
                )}
                {onDiffClick && (
                  <Tooltip label="View diff">
                    <button type="button"
                      className={styles.diffBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDiffClick(file);
                      }}
                      aria-label={`View diff for ${file.fileName}`}
                    >
                      <Eye size={14} />
                    </button>
                  </Tooltip>
                )}
                {onFileClick && (
                  <ExternalLink size={12} className={styles.previewHint} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
