import React, { useMemo, useState } from 'react';
import { highlightLine, languageFromPath } from '../../ui/syntaxHighlight';
import { DesignFileIcon, DesignNavIcon, DesignOpenWithIcon, type DesignOpenWithIconName } from '../designIcons';
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

type FilePreviewMode = 'code' | 'markdown' | 'diff';

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
  const [mode, setMode] = useState<FilePreviewMode>(defaultPreviewMode(filename));
  const [openMenuVisible, setOpenMenuVisible] = useState(false);
  const [lastOpenTarget, setLastOpenTarget] = useState<string | null>(null);
  const codeLanguage = languageFromPath(filename);
  const lines = useMemo(() => content.split('\n'), [content]);
  const diffLines = useMemo(() => (diffContent ?? syntheticDiff(filename, content)).split('\n'), [content, diffContent, filename]);
  const langLabel = fileTypeLabel(filename, language);
  const canRenderMarkdown = isMarkdownFile(filename);

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
        <div className={styles.modeTabs} role="tablist" aria-label="文件预览模式">
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
            aria-label="打开方式"
            className={styles.openWithBtn}
            onClick={() => setOpenMenuVisible((value) => !value)}
            title="打开方式"
            type="button"
          >
            <DesignNavIcon name="tools" size={14} />
          </button>
          {openMenuVisible && (
            <div className={styles.openWithMenu} role="menu" aria-label="打开方式菜单">
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
          aria-label="返回概览"
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

      {mode === 'markdown' ? (
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
  return (
    <pre className={styles.code} tabIndex={0} aria-label="Diff 预览">
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
  return (
    <article className={styles.markdownPreview} aria-label="Markdown 预览">
      {content.split('\n').map((line, index) => renderMarkdownLine(line, index))}
    </article>
  );
}

function renderMarkdownLine(line: string, index: number): React.ReactElement {
  if (line.startsWith('## ')) return <h2 key={index}>{line.slice(3)}</h2>;
  if (line.startsWith('# ')) return <h1 key={index}>{line.slice(2)}</h1>;
  if (line.startsWith('- ')) return <p className={styles.markdownListItem} key={index}>{line.slice(2)}</p>;
  if (/^\d+\.\s/.test(line)) return <p className={styles.markdownListItem} key={index}>{line}</p>;
  if (!line.trim()) return <div className={styles.markdownGap} key={index} />;
  return <p key={index}>{line}</p>;
}

function defaultPreviewMode(filename: string): FilePreviewMode {
  return isMarkdownFile(filename) ? 'markdown' : 'code';
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
