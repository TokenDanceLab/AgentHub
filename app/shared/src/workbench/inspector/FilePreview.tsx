import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { highlightLine, languageFromPath } from '../../ui/syntaxHighlight';
import MarkdownContent from '../../ui/Markdown';
import { DesignFileIcon, DesignNavIcon, DesignOpenWithIcon, type DesignOpenWithIconName } from '../designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '../../chatview/i18n/resources';
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
  diffContent?: string | undefined;
  onClose: () => void;
}

type FilePreviewMode = 'code' | 'markdown' | 'diff' | 'pdf' | 'html' | 'image' | 'text';

interface OpenWithItem {
  label: string;
  icon: DesignOpenWithIconName;
}

const openWithItems: OpenWithItem[] = [
  { label: 'VS Code', icon: 'vscode' },
  { label: 'Visual Studio', icon: 'visualStudio' },
  { label: 'Cursor', icon: 'cursor' },
  { label: 'Antigravity', icon: 'antigravity' },
  { label: 'Default app', icon: 'defaultApp' },
  { label: 'Terminal', icon: 'terminal' },
  { label: 'Git Bash', icon: 'gitBash' },
  { label: 'WSL', icon: 'wsl' },
  { label: 'Android Studio', icon: 'androidStudio' },
  { label: '打开所在文件夹', icon: 'folder' },
];

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
  const isNativeImage = isImageFile(filename);
  const isNativePdf = isPdfFile(filename);
  const isNativeHtml = isHtmlFile(filename);
  const isPlainText = isTextFile(filename);
  const canRenderMarkdown = isMarkdownFile(filename);
  const nativeMode = isNativePdf ? 'pdf' : isNativeHtml ? 'html' : isNativeImage ? 'image' : isPlainText ? 'text' : null;

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
              {nativeMode === 'pdf' ? 'PDF' : nativeMode === 'html' ? 'HTML' : nativeMode === 'image' ? '图片' : '文本'}
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

function CodePreview({ language, lines }: { language: string; lines: string[] }): React.ReactElement {
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

function DiffPreview({ language, lines }: { language: string; lines: string[] }): React.ReactElement {
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

function MarkdownPreview({ content }: { content: string }): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <article className={styles.markdownPreview} aria-label={t('aria.markdownPreview')}>
      <MarkdownContent content={content} />
    </article>
  );
}

function defaultPreviewMode(filename: string): FilePreviewMode {
  if (isPdfFile(filename)) return 'pdf';
  if (isHtmlFile(filename)) return 'html';
  if (isImageFile(filename)) return 'image';
  if (isTextFile(filename)) return 'text';
  if (isMarkdownFile(filename)) return 'markdown';
  return 'code';
}

function isPdfFile(filename: string): boolean {
  return /\.pdf$/i.test(filename);
}

function isHtmlFile(filename: string): boolean {
  return /\.(html?|htm)$/i.test(filename);
}

function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i.test(filename);
}

function isTextFile(filename: string): boolean {
  return /\.(txt|log|csv)$/i.test(filename);
}

function isMarkdownFile(filename: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(filename);
}

function syntheticDiff(filename: string, content: string): string {
  const lines = content.split('\n');
  return [
    `diff --git a/${filename} b/${filename}`,
    `--- a/${filename}`,
    `+++ b/${filename}`,
    '@@ readonly preview @@',
    ...lines.map((line, index) => (index < 3 ? `+${line}` : ` ${line}`)),
  ].join('\n');
}

function diffLineClass(line: string, css: typeof styles): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return css.diffAdd ?? '';
  if (line.startsWith('-') && !line.startsWith('---')) return css.diffDel ?? '';
  return '';
}

function PdfPreview({ filename }: { filename: string }): React.ReactElement {
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

function HtmlPreview({ content }: { content: string }): React.ReactElement {
  return (
    <iframe
      title="HTML 预览"
      style={{ flex: 1, border: 0, minHeight: 0 }}
      srcDoc={content}
      sandbox="allow-scripts"
      role="document"
    />
  );
}

function ImagePreview({ filename }: { filename: string }): React.ReactElement {
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
        color: 'var(--text-3)',
        font: '400 0.75rem var(--font-sans)',
      }}>
        <DesignFileIcon className={styles.fileIcon} name={filename} />
        <span>图片预览: {filename}</span>
        <span style={{ fontSize: '0.6875rem' }}>图片内容将通过文件 URL 加载</span>
      </div>
    </div>
  );
}

function TextPreview({ content }: { content: string }): React.ReactElement {
  return (
    <pre className={styles.code} tabIndex={0} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      <code className={styles.codeInner}>{content}</code>
    </pre>
  );
}

function highlightDiffLine(line: string, language: string): string {
  if (!line || line.startsWith('diff ') || line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
    return highlightLine(line, '');
  }
  const marker = line[0] === '+' || line[0] === '-' || line[0] === ' ' ? line[0] : '';
  const body = marker ? line.slice(1) : line;
  return `${highlightLine(marker, '')}${highlightLine(body, language)}`;
}

function openWithIconClass(name: DesignOpenWithIconName): string {
  switch (name) {
    case 'defaultApp':
      return `${styles.brandIconSvg} ${styles.vendorDefault}`;
    case 'terminal':
      return `${styles.brandIconSvg} ${styles.vendorTerminal}`;
    case 'folder':
      return `${styles.brandIconSvg} ${styles.vendorFolder}`;
    default:
      return styles.brandIconSvg ?? '';
  }
}
