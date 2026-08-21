import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageFromPath } from '@shared/ui/syntaxHighlight';
import { DesignFileIcon, DesignNavIcon, DesignOpenWithIcon } from '../designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { Button } from '@shared/ui/Button';
import { Tooltip } from '@shared/ui/Tooltip';
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
  const [openWithActiveIndex, setOpenWithActiveIndex] = useState(0);
  const openWithMenuRef = useRef<HTMLDivElement>(null);
  const openWithTriggerRef = useRef<HTMLButtonElement>(null);
  const openWithKeyboardRef = useRef(false);
  const codeLanguage = languageFromPath(filename);
  const lines = useMemo(() => content.split('\n'), [content]);
  const diffLines = useMemo(() => (diffContent ?? syntheticDiff(filename, content)).split('\n'), [content, diffContent, filename]);
  const langLabel = fileTypeLabel(filename, language);
  const canRenderMarkdown = isMarkdownFile(filename);
  const nativeMode = resolveNativeMode(filename);

  // Roving tabindex for the mode tablist. The visible tabs depend on the
  // file (nativeMode/markdown may be absent), so the tab array is rebuilt
  // per-render and the active tab is the single tab stop. ArrowLeft/Right
  // and Home/End move the stop; only keyboard-driven moves steal focus so
  // mouse clicks don't disrupt where the user is. Mirrors GlobalRail.tsx.
  const modeTabsListRef = useRef<HTMLDivElement>(null);
  const tabsKeyboardRef = useRef(false);
  const modeTabs = useMemo<{ mode: FilePreviewMode; label: string }[]>(() => {
    const tabs: { mode: FilePreviewMode; label: string }[] = [];
    if (nativeMode) tabs.push({ mode: nativeMode, label: nativeModeLabel(nativeMode) });
    tabs.push({ mode: 'code', label: t('filePreview.modeSource') });
    if (canRenderMarkdown) tabs.push({ mode: 'markdown', label: t('filePreview.modePreview') });
    tabs.push({ mode: 'diff', label: 'Diff' });
    return tabs;
  }, [nativeMode, canRenderMarkdown, t]);

  const [rovingTabIndex, setRovingTabIndex] = useState(() =>
    Math.max(0, modeTabs.findIndex((tab) => tab.mode === mode)),
  );

  useEffect(() => {
    const index = modeTabs.findIndex((tab) => tab.mode === mode);
    if (index >= 0) setRovingTabIndex(index);
  }, [mode, modeTabs]);

  useEffect(() => {
    if (!tabsKeyboardRef.current || !modeTabsListRef.current) return;
    tabsKeyboardRef.current = false;
    const tabs = modeTabsListRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[rovingTabIndex]?.focus();
  }, [rovingTabIndex]);

  function handleTabsKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (modeTabs.length === 0) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (rovingTabIndex + 1) % modeTabs.length;
        break;
      case 'ArrowLeft':
        next = (rovingTabIndex - 1 + modeTabs.length) % modeTabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = modeTabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    tabsKeyboardRef.current = true;
    setRovingTabIndex(next);
    setMode(modeTabs[next]!.mode);
  }

  // Open-with menu: focus first item on open, rove with arrows, close on Esc,
  // and restore focus to the trigger on close. Mirrors ContextMenu.tsx.
  useEffect(() => {
    if (!openMenuVisible) return;
    setOpenWithActiveIndex(0);
    openWithKeyboardRef.current = true;
    const raf = requestAnimationFrame(() => {
      const items = openWithMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      items?.[0]?.focus();
    });
    const handleKey = (event: KeyboardEvent) => {
      const count = openWithItems.length;
      if (count === 0) return;
      let next: number;
      switch (event.key) {
        case 'ArrowDown':
          next = (openWithActiveIndex + 1) % count;
          break;
        case 'ArrowUp':
          next = (openWithActiveIndex - 1 + count) % count;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = count - 1;
          break;
        case 'Escape':
          event.preventDefault();
          setOpenMenuVisible(false);
          openWithTriggerRef.current?.focus();
          return;
        default:
          return;
      }
      event.preventDefault();
      openWithKeyboardRef.current = true;
      setOpenWithActiveIndex(next);
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openMenuVisible, openWithActiveIndex]);

  useEffect(() => {
    if (!openWithKeyboardRef.current || !openWithMenuRef.current) return;
    openWithKeyboardRef.current = false;
    const items = openWithMenuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items[openWithActiveIndex]?.focus();
  }, [openWithActiveIndex]);

  return (
    <section
      className={styles.pane}
      aria-label={t('filePreview.ariaPane', { filename })}
    >
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.fileTitle}>
          <DesignFileIcon className={styles.fileIcon} name={filename} />
          <strong className={styles.fileTitleName} title={filename}>{filename}</strong>
        </div>
        <div
          className={styles.modeTabs}
          onKeyDown={handleTabsKeyDown}
          ref={modeTabsListRef}
          role="tablist"
          aria-label={t('aria.filePreviewMode')}
        >
          {modeTabs.map((tab, index) => (
            <button type="button"
              aria-selected={mode === tab.mode}
              className={styles.modeTab}
              key={tab.mode}
              onClick={() => setMode(tab.mode)}
              role="tab"
              tabIndex={index === rovingTabIndex ? 0 : -1}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className={styles.openWithWrap}>
          <Tooltip label={t('filePreview.openWith')}>
            <button type="button"
              ref={openWithTriggerRef}
              aria-expanded={openMenuVisible}
              aria-haspopup="menu"
              aria-label={t('aria.openWith')}
              className={styles.openWithBtn}
              onClick={() => setOpenMenuVisible((value) => !value)}
            >
              <DesignNavIcon name="tools" size={14} />
            </button>
          </Tooltip>
          {openMenuVisible && (
            <div className={styles.openWithMenu} ref={openWithMenuRef} role="menu" aria-label={t('aria.openWithMenu')}>
              {openWithItems.map((item, index) => (
                <button
                  key={item.label}
                  role="menuitem"
                  tabIndex={index === openWithActiveIndex ? 0 : -1}
                  type="button"
                  onClick={() => {
                    setLastOpenTarget(item.label);
                    setOpenMenuVisible(false);
                    openWithTriggerRef.current?.focus();
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
        <Tooltip label={t('filePreview.backToOverview')}>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onClose}
            aria-label={t('aria.backToOverview')}
          >
            <DesignNavIcon name="close" size={15} />
          </Button>
        </Tooltip>
      </div>

      {/* ── Meta bar ── */}
      <div className={styles.meta}>
        <span className={styles.metaItem}>{owner}</span>
        <span className={styles.metaItem}>{langLabel}</span>
        <span className={styles.metaItem}>{t('filePreview.readonly')}</span>
        <span className={styles.metaItem}>{mode === 'diff' ? diffLines.length : lines.length} lines</span>
        {lastOpenTarget && (
          <span className={styles.metaItem}>
            {t('filePreview.selectedTarget', { target: lastOpenTarget })}
          </span>
        )}
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
