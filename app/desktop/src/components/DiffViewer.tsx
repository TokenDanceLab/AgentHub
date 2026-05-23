// GitHub-style diff viewer with file tree, collapsible hunks, and line numbers
import { useState } from 'react';
import { Check, X, ChevronRight, FileCode } from 'lucide-react';
import type { FileDiff, DiffHunk } from './ChatView.types';
import styles from './DiffViewer.module.css';

interface Props {
  files: FileDiff[];
  onAcceptFile?: (path: string) => void;
  onRejectFile?: (path: string) => void;
}

export default function DiffViewer({ files, onAcceptFile, onRejectFile }: Props) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set(files.map((f) => f.filePath)));
  const [activeFile, setActiveFile] = useState<string | null>(files[0]?.filePath ?? null);

  if (files.length === 0) {
    return <div className={styles.empty}>No changes to display</div>;
  }

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () => setExpandedFiles(new Set(files.map((f) => f.filePath)));
  const collapseAll = () => setExpandedFiles(new Set());

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className={styles.root}>
      <div className={styles.fileTree}>
        <div className={styles.fileTreeHeader}>
          <span className={styles.fileTreeTitle}>
            {files.length} changed file{files.length !== 1 ? 's' : ''}
          </span>
          <span className={styles.fileTreeStats}>
            <span className={styles.addedCount}>+{totalAdditions}</span>
            <span className={styles.deletedCount}>-{totalDeletions}</span>
          </span>
          <div className={styles.fileTreeActions}>
            <button className={styles.miniBtn} onClick={expandAll} title="Expand all">
              <ChevronRight size={14} style={{ transform: 'rotate(90deg)' }} />
            </button>
            <button className={styles.miniBtn} onClick={collapseAll} title="Collapse all">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
        <div className={styles.fileTreeList}>
          {files.map((file) => (
            <button
              key={file.filePath}
              className={`${styles.fileTreeItem} ${activeFile === file.filePath ? styles.fileTreeItemActive : ''}`}
              onClick={() => {
                setActiveFile(file.filePath);
                setExpandedFiles((prev) => {
                  const next = new Set(prev);
                  next.add(file.filePath);
                  return next;
                });
              }}
            >
              <FileCode size={14} className={styles.fileTreeIcon} />
              <span className={styles.fileTreePath}>{file.filePath}</span>
              <span className={statusBadgeClass(file.status)}>{statusLabel(file.status)}</span>
              <span className={styles.addedCount}>+{file.additions}</span>
              <span className={styles.deletedCount}>-{file.deletions}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.diffPanel}>
        {files.map((file) => (
          <FileDiffSection
            key={file.filePath}
            file={file}
            expanded={expandedFiles.has(file.filePath)}
            onToggle={() => toggleFile(file.filePath)}
            onAcceptFile={onAcceptFile}
            onRejectFile={onRejectFile}
          />
        ))}
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  return 'M';
}

function statusBadgeClass(status: string): string {
  if (status === 'added') return `${styles.statusBadge} ${styles.statusAdded}`;
  if (status === 'deleted') return `${styles.statusBadge} ${styles.statusDeleted}`;
  return `${styles.statusBadge} ${styles.statusModified}`;
}

function FileDiffSection({
  file,
  expanded,
  onToggle,
  onAcceptFile,
  onRejectFile,
}: {
  file: FileDiff;
  expanded: boolean;
  onToggle: () => void;
  onAcceptFile?: (path: string) => void;
  onRejectFile?: (path: string) => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [rejected, setRejected] = useState(false);

  const handleAccept = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (accepted) {
      setAccepted(false);
      return;
    }
    setAccepted(true);
    setRejected(false);
    onAcceptFile?.(file.filePath);
  };

  const handleReject = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (rejected) {
      setRejected(false);
      return;
    }
    setRejected(true);
    setAccepted(false);
    onRejectFile?.(file.filePath);
  };

  const sectionClass = [
    styles.fileSection,
    accepted && styles.fileAccepted,
    rejected && styles.fileRejected,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={sectionClass}>
      <div className={styles.fileHeader}>
        <button className={styles.fileHeaderBtn} onClick={onToggle} aria-expanded={expanded}>
          <ChevronRight
            size={14}
            className={`${styles.chevron} ${expanded ? styles.chevronDown : ''}`}
          />
          <span className={statusBadgeClass(file.status)}>{statusLabel(file.status)}</span>
          <code className={styles.filePath}>{file.filePath}</code>
          <span className={styles.fileChangeStats}>
            <span className={styles.addedCount}>+{file.additions}</span>
            <span className={styles.deletedCount}>-{file.deletions}</span>
          </span>
        </button>

        <button
          className={`${styles.actionBtn} ${styles.acceptBtn} ${accepted ? styles.acceptBtnActive : ''}`}
          onClick={handleAccept}
          title={accepted ? 'Undo accept' : 'Accept all changes in this file'}
          aria-label={accepted ? 'Undo accept' : 'Accept file'}
        >
          <Check size={14} />
        </button>
        <button
          className={`${styles.actionBtn} ${styles.rejectBtn} ${rejected ? styles.rejectBtnActive : ''}`}
          onClick={handleReject}
          title={rejected ? 'Undo reject' : 'Reject all changes in this file'}
          aria-label={rejected ? 'Undo reject' : 'Reject file'}
        >
          <X size={14} />
        </button>
      </div>

      {expanded && (
        <div className={styles.fileBody}>
          {file.hunks.map((hunk, i) => (
            <HunkRenderer key={i} hunk={hunk} />
          ))}
        </div>
      )}
    </div>
  );
}

function HunkRenderer({ hunk }: { hunk: DiffHunk }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={styles.hunk}>
      <button className={styles.hunkHeader} onClick={() => setCollapsed((v) => !v)}>
        <ChevronRight
          size={12}
          className={`${styles.hunkChevron} ${collapsed ? '' : styles.hunkChevronDown}`}
        />
        <code className={styles.hunkHeaderText}>{hunk.header}</code>
      </button>
      {!collapsed && (
        <div className={styles.hunkBody}>
          {hunk.lines.map((line, j) => (
            <div
              key={j}
              className={
                line.type === 'added'
                  ? styles.lineAdded
                  : line.type === 'deleted'
                    ? styles.lineDeleted
                    : styles.lineContext
              }
            >
              <span className={styles.lineNumOld}>
                {line.oldLineNumber != null ? line.oldLineNumber : ''}
              </span>
              <span className={styles.lineNumNew}>
                {line.newLineNumber != null ? line.newLineNumber : ''}
              </span>
              <span className={styles.lineSign}>
                {line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ''}
              </span>
              <span className={styles.lineContent}>{line.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
