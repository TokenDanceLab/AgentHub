// Unified diff viewer — collapsible file headers + hunk rendering
// 参考: CCViewer DiffViewer.tsx (530 lines)
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { FileDiff, DiffHunk } from './ChatView.types';
import styles from './DiffViewer.module.css';

interface Props {
  files: FileDiff[];
  onAcceptFile?: (path: string) => void;
  onRejectFile?: (path: string) => void;
}

export default function DiffViewer({ files, onAcceptFile, onRejectFile }: Props) {
  if (files.length === 0) {
    return <div className={styles.empty}>No changes to display</div>;
  }

  return (
    <div className={styles.root}>
      {files.map((file) => (
        <FileDiffSection
          key={file.filePath}
          file={file}
          onAcceptFile={onAcceptFile}
          onRejectFile={onRejectFile}
        />
      ))}
    </div>
  );
}

function FileDiffSection({
  file,
  onAcceptFile,
  onRejectFile,
}: {
  file: FileDiff;
  onAcceptFile?: (path: string) => void;
  onRejectFile?: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
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

  const sectionClasses = [
    styles.fileSection,
    accepted && styles.fileAccepted,
    rejected && styles.fileRejected,
  ]
    .filter(Boolean)
    .join(' ');

  const chevronClass = styles.chevron + (collapsed ? '' : ' ' + styles.chevronDown);

  return (
    <div className={sectionClasses}>
      <div className={styles.fileHeader}>
        <button
          className={styles.fileHeaderBtn}
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          <span className={statusClass(file.status)}>
            {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
          </span>
          <code className={styles.filePath}>{file.filePath}</code>
          <span className={styles.addedCount}>+{file.additions}</span>
          <span className={styles.deletedCount}>-{file.deletions}</span>
          <span className={chevronClass}>▸</span>
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

      {!collapsed && (
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
  return (
    <div className={styles.hunk}>
      <div className={styles.hunkHeader}>{hunk.header}</div>
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
          <span className={styles.lineNum}>{line.oldLineNumber ?? ''}</span>
          <span className={styles.lineNum}>{line.newLineNumber ?? ''}</span>
          <span className={styles.lineContent}>
            {line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' '}
            {line.content}
          </span>
        </div>
      ))}
    </div>
  );
}

function statusClass(status: string): string {
  switch (status) {
    case 'added':
      return styles.statusAdded;
    case 'deleted':
      return styles.statusDeleted;
    default:
      return styles.statusModified;
  }
}
