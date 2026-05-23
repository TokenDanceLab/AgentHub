// Unified diff viewer — collapsible file headers + hunk rendering
// 参考: CCViewer DiffViewer.tsx (530 lines)
import { useState } from 'react';
import type { FileDiff, DiffHunk, DiffLine } from './ChatView.types';
import styles from './DiffViewer.module.css';

interface Props {
  files: FileDiff[];
}

export default function DiffViewer({ files }: Props) {
  if (files.length === 0) {
    return <div className={styles.empty}>No changes to display</div>;
  }

  return (
    <div className={styles.root}>
      {files.map((file) => (
        <FileDiffSection key={file.filePath} file={file} />
      ))}
    </div>
  );
}

function FileDiffSection({ file }: { file: FileDiff }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={styles.fileSection}>
      <button
        className={styles.fileHeader}
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className={statusClass(file.status)}>
          {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
        </span>
        <code className={styles.filePath}>{file.filePath}</code>
        <span className={styles.addedCount}>+{file.additions}</span>
        <span className={styles.deletedCount}>-{file.deletions}</span>
        <span className={styles.chevron + (collapsed ? '' : ' ' + styles.chevronDown)}>▸</span>
      </button>

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
            line.type === 'added' ? styles.lineAdded
            : line.type === 'deleted' ? styles.lineDeleted
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
    case 'added': return styles.statusAdded;
    case 'deleted': return styles.statusDeleted;
    default: return styles.statusModified;
  }
}
