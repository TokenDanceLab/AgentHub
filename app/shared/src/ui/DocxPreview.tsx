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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, RotateCcw, X } from 'lucide-react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import type { Config as DOMPurifyConfig } from 'dompurify';
import styles from './DocxPreview.module.css';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';

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
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // DOMPurify config: keep bold, italic, lists, tables, images — strip scripts, event handlers, etc.
  const purifyConfig = useRef<DOMPurifyConfig>({
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
      'a',  // keep for navigation but ATTRIBUTES will strip dangerous ones
      'img',
      'blockquote', 'pre', 'code',
      'sup', 'sub',
      'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
  });

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
          setError(t('preview.error.fetch', { status: response.status }));
          return;
        }
        arrayBuffer = await response.arrayBuffer();
      }

      const mammoth = await import('mammoth');
      const result = await mammoth.default.convertToHtml({ arrayBuffer });
      // Load DOMPurify alongside mammoth so neither stays in the main chunk.
      const { default: DOMPurify } = await import('dompurify');
      const sanitized: string = DOMPurify.sanitize(result.value, purifyConfig.current);
      setHtml(sanitized);
    } catch {
      setError(t('preview.error.docxParse'));
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
          <Tooltip label={t("aria.closePreview")}>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={onClose}
              aria-label={t("aria.closePreview")}
            >
              <X size={16} />
            </Button>
          </Tooltip>
        )}
      </div>

      {/* ── Content ── */}
      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>{t('preview.parsing')}</span>
        </div>
      )}

      {error && (
        <div className={styles.error}>
          <AlertCircle size={28} className={styles.errorIcon} />
          <span className={styles.errorMessage}>{error}</span>
          <button className={styles.retryBtn} onClick={loadDocx} type="button">
            <RotateCcw size={14} />
            <span>{t('preview.retry')}</span>
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
