import React from 'react';
import { useTranslation } from 'react-i18next';
import { highlightLine } from '@shared/ui/syntaxHighlight';
import MarkdownContent from '@shared/ui/Markdown';
import { PREVIEW_SANDBOX_SRCDOC } from '@shared/ui/previewSandbox';
import { DesignFileIcon } from '../designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { diffLineClass, highlightDiffLine } from './FilePreviewHelpers';
import styles from './FilePreview.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   FilePreviewParts — presentational residual slices from FilePreview (#663).

   Code/diff/markdown/native preview bodies. CSS stays on
   FilePreview.module.css. No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export function CodePreview({ language, lines }: { language: string; lines: string[] }): React.ReactElement {
  return (
    <pre className={styles.code} tabIndex={0}>
      <code className={styles.codeInner}>
        {lines.map((line, i) => (
          <span className={styles.line} key={i}>
            <em className={styles.lineNum}>{i + 1}</em>
            <b
              className={styles.lineContent}
              dangerouslySetInnerHTML={{ __html: highlightLine(line || ' ', language) }}
            />
          </span>
        ))}
      </code>
    </pre>
  );
}

export function DiffPreview({ language, lines }: { language: string; lines: string[] }): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <pre className={styles.code} tabIndex={0} aria-label={t('aria.diffPreview')}>
      <code className={styles.codeInner}>
        {lines.map((line, i) => (
          <span className={`${styles.line} ${diffLineClass(line, styles)}`} key={i}>
            <em className={styles.lineNum}>{i + 1}</em>
            <b
              className={styles.lineContent}
              dangerouslySetInnerHTML={{ __html: highlightDiffLine(line || ' ', language) }}
            />
          </span>
        ))}
      </code>
    </pre>
  );
}

export function MarkdownPreview({ content }: { content: string }): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <article className={styles.markdownPreview} aria-label={t('aria.markdownPreview')}>
      <MarkdownContent content={content} />
    </article>
  );
}

export function PdfPreview({ filename }: { filename: string }): React.ReactElement {
  // Browser-native PDF rendering via iframe. The filename is used as a hint;
  // in a real integration, the actual file URL would be passed instead.
  // When content is a data URI or blob URL, it can be loaded directly.
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <iframe
        title={`PDF 预览 ${filename}`}
        style={{ flex: 1, border: 0, minHeight: 0 }}
        src={`data:application/pdf;base64,`}
        role="document"
      />
    </div>
  );
}

export function HtmlPreview({ content }: { content: string }): React.ReactElement {
  return (
    <iframe
      title="HTML 预览"
      style={{ flex: 1, border: 0, minHeight: 0 }}
      srcDoc={content}
      sandbox={PREVIEW_SANDBOX_SRCDOC}
      role="document"
    />
  );
}

export function ImagePreview({ filename }: { filename: string }): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  // Image preview — the actual image URL would be resolved by the parent.
  // Shows a placeholder when only filename is available.
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      minHeight: 0,
      overflow: 'auto',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        color: 'var(--td-ink-subtle)',
        font: '400 0.75rem var(--td-font)',
      }}>
        <DesignFileIcon className={styles.fileIcon} name={filename} />
        <span>图片预览: {filename}</span>
        <span style={{ fontSize: '0.6875rem' }}>{t('filePreview.imageViaFileUrl')}</span>
      </div>
    </div>
  );
}

export function TextPreview({ content }: { content: string }): React.ReactElement {
  return (
    <pre className={styles.code} tabIndex={0} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      <code className={styles.codeInner}>{content}</code>
    </pre>
  );
}
