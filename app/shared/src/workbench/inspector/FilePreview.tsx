import React, { useMemo } from 'react';
import { DesignFileIcon, DesignNavIcon } from '../designIcons';
import styles from './FilePreview.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   FilePreview — Slide-in read-only code editor with line numbers.

   Props:
     filename  — Display name shown in the toolbar
     language  — Optional language / type label (shown below filename)
     content   — Raw text content; split into lines for rendering
     onClose   — Called when the close button is clicked

   Mirrors the desktop demo .readonly-editor visual design using ONLY
   v4 CSS custom properties. Pure presentational — no data fetching.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────────────────────────────

export interface FilePreviewProps {
  filename: string;
  owner?: string | undefined;
  language?: string | undefined;
  content: string;
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Derive a display label for the file type from filename extension. */
function fileTypeLabel(filename: string, language?: string): string {
  if (language) return language.toUpperCase();
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!ext || ext === filename.toLowerCase()) return 'file';
  return ext.toUpperCase();
}

// ── Component ────────────────────────────────────────────────────────────

export const FilePreview: React.FC<FilePreviewProps> = ({
  filename,
  owner = 'builder',
  language,
  content,
  onClose,
}) => {
  const lines = useMemo(() => content.split('\n'), [content]);
  const langLabel = fileTypeLabel(filename, language);

  return (
    <section
      className={styles.pane}
      aria-label={`${filename} 只读预览`}
    >
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.fileTitle}>
          <DesignFileIcon className={styles.fileIcon} name={filename} />
          <div className={styles.fileTitleText}>
            <strong className={styles.fileTitleName}>{filename}</strong>
            <span className={styles.fileTitleLang}>
              只读 · {langLabel}
            </span>
          </div>
        </div>
        <button
          className={styles.closeBtn}
          type="button"
          onClick={onClose}
          title="返回概览"
          aria-label="返回概览"
        >
          <DesignNavIcon name="close" size={15} />
        </button>
      </div>

      {/* ── Meta bar ── */}
      <div className={styles.meta}>
        <span className={styles.metaItem}>{owner}</span>
        <span className={styles.metaItem}>UTF-8</span>
        <span className={styles.metaItem}>Read only</span>
        <span className={styles.metaItem}>{lines.length} lines</span>
      </div>

      {/* ── Code area ── */}
      <pre className={styles.code} tabIndex={0}>
        <code className={styles.codeInner}>
          {lines.map((line, i) => (
            <span className={styles.line} key={i}>
              <em className={styles.lineNum}>{i + 1}</em>
              <b className={styles.lineContent}>{line || ' '}</b>
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
};
