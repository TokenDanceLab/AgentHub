import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageFromPath } from '../../ui/syntaxHighlight';
import { DesignFileIcon, DesignNavIcon, DesignOpenWithIcon } from '../designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '../../chatview/i18n/resources';
import {
  defaultPreviewMode,
  fileTypeLabel,
  isMarkdownFile,
  nativeModeLabel,
  openWithIconClass,
  openWithItems,
  resolveNativeMode,
  syntheticDiff,
  type FilePreviewMode,
} from './FilePreviewHelpers';
import {
  CodePreview,
  DiffPreview,
  HtmlPreview,
  ImagePreview,
  MarkdownPreview,
  PdfPreview,
  TextPreview,
} from './FilePreviewParts';
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
   Residual pure helpers live in FilePreviewHelpers; preview bodies in
   FilePreviewParts (#663).
   ═══════════════════════════════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────────────────────────────

export interface FilePreviewProps {
  filename: string;
  owner?: string | undefined;
  language?: string | undefined;
  content: string;
  diffContent?: string | undefined;
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────────

export const FilePreview: React.FC<FilePreviewProps> = ({
  filename,
  owner = 'builder',
  language,
  content,
  diffContent,
  onClose,
}) => {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [mode, setMode] = useState<FilePreviewMode>(defaultPreviewMode(filename));
  const [openMenuVisible, setOpenMenuVisible] = useState(false);
  const [lastOpenTarget, setLastOpenTarget] = useState<string | null>(null);
  const codeLanguage = languageFromPath(filename);
  const lines = useMemo(() => content.split('\n'), [content]);
  const diffLines = useMemo(() => (diffContent ?? syntheticDiff(filename, content)).split('\n'), [content, diffContent, filename]);
  const langLabel = fileTypeLabel(filename, language);
  const canRenderMarkdown = isMarkdownFile(filename);
  const nativeMode = resolveNativeMode(filename);

  return (
    <section
      className={styles.pane}
      aria-label={`${filename} 只读预览`}
    >
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.fileTitle}>
          <DesignFileIcon className={styles.fileIcon} name={filename} />
          <strong className={styles.fileTitleName} title={filename}>{filename}</strong>
        </div>
        <div className={styles.modeTabs} role="tablist" aria-label={t('aria.filePreviewMode')}>
          {nativeMode && (
            <button
              aria-selected={mode === nativeMode}
              className={styles.modeTab}
              onClick={() => setMode(nativeMode)}
              role="tab"
              type="button"
            >
              {nativeModeLabel(nativeMode)}
            </button>
          )}
          <button
            aria-selected={mode === 'code'}
            className={styles.modeTab}
            onClick={() => setMode('code')}
            role="tab"
            type="button"
          >
            源码
          </button>
          {canRenderMarkdown && (
            <button
              aria-selected={mode === 'markdown'}
              className={styles.modeTab}
              onClick={() => setMode('markdown')}
              role="tab"
              type="button"
            >
              预览
            </button>
          )}
          <button
            aria-selected={mode === 'diff'}
            className={styles.modeTab}
            onClick={() => setMode('diff')}
            role="tab"
            type="button"
          >
            Diff
          </button>
        </div>
        <div className={styles.openWithWrap}>
          <button
            aria-expanded={openMenuVisible}
            aria-haspopup="menu"
            aria-label={t('aria.openWith')}
            className={styles.openWithBtn}
            onClick={() => setOpenMenuVisible((value) => !value)}
            title="打开方式"
            type="button"
          >
            <DesignNavIcon name="tools" size={14} />
          </button>
          {openMenuVisible && (
            <div className={styles.openWithMenu} role="menu" aria-label={t('aria.openWithMenu')}>
              {openWithItems.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setLastOpenTarget(item.label);
                    setOpenMenuVisible(false);
                  }}
                >
                  <span aria-hidden="true" className={styles.openWithIcon}>
                    <DesignOpenWithIcon
                      className={openWithIconClass(item.icon)}
                      imageClassName={styles.brandIconImage}
                      name={item.icon}
                    />
                  </span>
                  <span className={styles.openWithLabel}>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className={styles.closeBtn}
          type="button"
          onClick={onClose}
          title="返回概览"
          aria-label={t('aria.backToOverview')}
        >
          <DesignNavIcon name="close" size={15} />
        </button>
      </div>

      {/* ── Meta bar ── */}
      <div className={styles.meta}>
        <span className={styles.metaItem}>{owner}</span>
        <span className={styles.metaItem}>{langLabel}</span>
        <span className={styles.metaItem}>只读</span>
        <span className={styles.metaItem}>{mode === 'diff' ? diffLines.length : lines.length} lines</span>
        {lastOpenTarget && <span className={styles.metaItem}>已选择 {lastOpenTarget}</span>}
      </div>

      {mode === 'pdf' ? (
        <PdfPreview filename={filename} />
      ) : mode === 'html' ? (
        <HtmlPreview content={content} />
      ) : mode === 'image' ? (
        <ImagePreview filename={filename} />
      ) : mode === 'text' ? (
        <TextPreview content={content} />
      ) : mode === 'markdown' ? (
        <MarkdownPreview content={content} />
      ) : mode === 'diff' ? (
        <DiffPreview lines={diffLines} language={codeLanguage} />
      ) : (
        <CodePreview language={codeLanguage} lines={lines} />
      )}
    </section>
  );
};
