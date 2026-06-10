/* ═══════════════════════════════════════════════════════════════════════
   DocxPreview — Browser-side .docx file renderer using mammoth.js

   Props:
     fileUrl   — URL to fetch the .docx file from
     fileName  — Display name shown in the header
     fileBlob  — Optional pre-fetched Blob (skips fetch)
     onClose   — Called when the close button is clicked

   Fetches the file, parses via mammoth.convertToHtml, and renders
   the resulting HTML in a styled container.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, RotateCcw, X } from 'lucide-react';
import styles from './DocxPreview.module.css';

export interface DocxPreviewProps {
  fileUrl: string;
  fileName: string;
  fileBlob?: Blob | undefined;
  onClose?: (() => void) | undefined;
}

export const DocxPreview: React.FC<DocxPreviewProps> = ({
  fileUrl,
  fileName,
  fileBlob,
  onClose,
}) => {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDocx = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHtml(null);

    try {
      let arrayBuffer: ArrayBuffer;

      if (fileBlob) {
        arrayBuffer = await fileBlob.arrayBuffer();
      } else {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
        }
        arrayBuffer = await response.arrayBuffer();
      }

      const mammoth = await import('mammoth');
      const result = await mammoth.default.convertToHtml({ arrayBuffer });
      setHtml(result.value);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error parsing DOCX file';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fileUrl, fileBlob]);

  useEffect(() => {
    void loadDocx();
  }, [loadDocx]);

  return (
    <section className={styles.root} aria-label={`${fileName} DOCX preview`}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={styles.fileName} title={fileName}>{fileName}</span>
          <span className={styles.badge}>DOCX</span>
        </div>
        {onClose && (
          <button
            className={styles.closeBtn}
            type="button"
            onClick={onClose}
            aria-label="关闭预览"
            title="关闭预览"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* ── Content ── */}
      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>正在解析文档...</span>
        </div>
      )}

      {error && (
        <div className={styles.error}>
          <AlertCircle size={28} className={styles.errorIcon} />
          <span className={styles.errorMessage}>{error}</span>
          <button className={styles.retryBtn} onClick={loadDocx} type="button">
            <RotateCcw size={14} />
            <span>重试</span>
          </button>
        </div>
      )}

      {!loading && !error && html !== null && (
        <div
          className={styles.content}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </section>
  );
};
