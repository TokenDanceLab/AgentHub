import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../i18n';
import {
  DesignNavIcon,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  type DesignNavIconName,
} from '../designIcons';
import type { WorkbenchDocumentPreview } from '../documentPreview';
import { FilePreview } from '../inspector';
import {
  resolveWorkbenchProfile,
  type WorkbenchProfileSource,
} from '../profileRegistry';
import styles from './DocsPage.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   DocsPage — pure presentational workbench page
   ═══════════════════════════════════════════════════════════════════════ */

// ── Data shapes ──

export interface DocRow {
  id: string;
  title: string;
  /** Optional tag badge (e.g. '内部', '共享', '外部') */
  tag?: string;
  location: string;
  owner: string;
  time: string;
}

export type DocsPane = 'recent' | 'owned' | 'shared' | 'starred';

export interface DocsPageNavItem {
  id: string;
  label: string;
  icon?: DesignNavIconName;
  /** Optional small text (e.g. '下载中...') */
  trailing?: string;
}

export interface DocsPageProps {
  /** Currently active nav item id */
  activeNav: string;
  /** Called when user clicks a nav item */
  onNavChange: (navId: string) => void;

  /** Search query */
  searchQuery?: string;
  /** Called when search input changes */
  onSearchChange?: ((query: string) => void) | undefined;

  /** Nav items rendered in the left sidebar */
  navItems: DocsPageNavItem[];

  /** Doc shortcuts shown under "我的文档库" caption */
  shortcuts?: string[];

  /** Doc tab pane */
  activeTab: DocsPane;
  /** Called when user switches tab */
  onTabChange?: ((tab: DocsPane) => void) | undefined;

  /** Doc table rows */
  rows: DocRow[];
  /** Agent/user profiles available for owner avatar resolution */
  profiles?: WorkbenchProfileSource[] | undefined;
  /** Currently selected document preview */
  activePreview?: WorkbenchDocumentPreview | null | undefined;

  /** Called when a doc row is clicked */
  onDocClick?: ((doc: DocRow) => void) | undefined;
  /** Called when document preview closes */
  onClosePreview?: (() => void) | undefined;

  /** Callbacks for action buttons */
  onCreateDoc?: (() => void) | undefined;
  onUploadDoc?: (() => void) | undefined;
  onTemplateLibrary?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  onPlusTab?: (() => void) | undefined;
  /** Called when a shortcut is clicked */
  onShortcutClick?: ((name: string) => void) | undefined;
  /** Called to delete a document */
  onDeleteDoc?: ((documentId: string) => Promise<unknown> | void) | undefined;
}

// ── Defaults ──

const DEFAULT_SHORTCUTS: string[] = [
  'NewAPI注册和导入CC-switch',
  '知识问答',
  'AgentHub 设计评审',
  '白盒方向调研报告',
];

// ── Design icons ──

function NavGlyph({ name }: { name: DesignNavIconName }) {
  return (
    <span className={styles.navGlyph}>
      <DesignNavIcon
        name={name}
        size={DESIGN_NAV_GLYPH_SIZE}
        strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH}
      />
    </span>
  );
}

// ── Nav item icon lookup ──

const NAV_ICONS: Record<string, DesignNavIconName> = {
  home: 'home',
  drive: 'drive',
  library: 'library',
  notes: 'notes',
  download: 'download',
};

// ── Tab definitions ──

const DOC_TABS: { id: DocsPane; labelKey: string }[] = [
  { id: 'recent', labelKey: 'docs.tab.recent' },
  { id: 'owned', labelKey: 'docs.tab.mine' },
  { id: 'shared', labelKey: 'docs.tab.shared' },
  { id: 'starred', labelKey: 'docs.tab.starred' },
];

// ── Sub-components ──

function DocTableRow({
  doc,
  onClick,
  onDelete,
  profiles = [],
}: {
  doc: DocRow;
  onClick?: ((doc: DocRow) => void) | undefined;
  onDelete?: ((doc: DocRow) => void) | undefined;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  const [confirming, setConfirming] = useState(false);
  const handleClick = useCallback(() => {
    onClick?.(doc);
  }, [doc, onClick]);
  const owner = resolveWorkbenchProfile(doc.owner, profiles);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    onDelete?.(doc);
    setConfirming(false);
  }, [confirming, doc, onDelete]);

  const handleCancelDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
  }, []);

  return (
    <button type="button" className={`${styles.docRow} doc-row`} data-card-surface onClick={handleClick}>
      <span className={styles.docTitle}>
        <span className={styles.docType}>
          <DesignNavIcon name="fileText" size={14} />
        </span>
        {doc.title}
        {doc.tag && <em className={styles.docTag}>{doc.tag}</em>}
      </span>
      <span>{doc.location}</span>
      <span className={styles.ownerPill} data-profile-kind={owner.kind}>
        <span
          className={styles.ownerAvatar}
          style={{ '--owner-avatar-color': owner.color } as React.CSSProperties}
        >
          {owner.initials}
        </span>
        <span>{owner.name}</span>
      </span>
      <span>{doc.time}</span>
      <span className={styles.docMore}>
        {confirming ? (
          <>
            <button type="button" className={styles.confirmDeleteBtn} onClick={handleDelete}>确认删除</button>
            <button type="button" className={styles.cancelDeleteBtn} onClick={handleCancelDelete}>取消</button>
          </>
        ) : onDelete ? (
          <button type="button" className={styles.docDeleteBtn} onClick={handleDelete} title="删除文档">
            <DesignNavIcon name="close" size={14} />
          </button>
        ) : (
          <DesignNavIcon name="more" size={14} />
        )}
      </span>
    </button>
  );
}

// ── Main component ──

export function DocsPage({
  activeNav,
  onNavChange,
  searchQuery = '',
  onSearchChange,
  navItems,
  shortcuts = DEFAULT_SHORTCUTS,
  activeTab,
  onTabChange,
  rows,
  profiles,
  activePreview,
  onDocClick,
  onClosePreview,
  onCreateDoc,
  onUploadDoc,
  onTemplateLibrary,
  onSettings,
  onPlusTab,
  onShortcutClick,
  onDeleteDoc,
}: DocsPageProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const resolvedNavItems =
    navItems.length > 0
      ? navItems
      : ([
          { id: 'home', label: '主页', icon: 'home' },
          { id: 'drive', label: '云盘', icon: 'drive' },
          { id: 'library', label: '知识库', icon: 'library' },
          { id: 'notes', label: '智能纪要', icon: 'notes' },
          { id: 'download', label: '离线', icon: 'download', trailing: '下载中...' },
        ] as DocsPageNavItem[]);

  return (
    <section className={`${styles.page} workbench docs-page`}>
      {/* ── Left nav ── */}
      <aside className={`${styles.nav} workbench-nav`}>
        <div className={`${styles.navTitle} workbench-title`}>{t('nav.docs')}</div>
        <input
          className={`${styles.search} workbench-search`}
          placeholder={t('header.search')}
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
        />

        {resolvedNavItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.navRow} ${
              activeNav === item.id ? styles.navRowActive : ''
            }`}
            onClick={() => onNavChange(item.id)}
          >
            <NavGlyph name={item.icon ?? NAV_ICONS[item.id] ?? 'fileText'} />
            {item.label}
            {item.trailing && (
              <small className={styles.navBadge}>{item.trailing}</small>
            )}
          </button>
        ))}

        <div className={styles.navCaption}>我的文档库</div>
        {shortcuts.map((name) => (
          <div
            key={name}
            className={styles.navShortcut}
            onClick={() => onShortcutClick?.(name)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onShortcutClick?.(name);
              }
            }}
          >
            {name}
          </div>
        ))}
      </aside>

      {/* ── Right main ── */}
      <main className={`${styles.main} workbench-main`}>
        {/* Head */}
        <div className={`${styles.head} workbench-head`}>
          <h1 className={styles.headTitle}>主页</h1>
          <button
            type="button"
            className={`${styles.iconAction} icon-action`}
            aria-label="云文档设置"
            onClick={onSettings}
          >
            <DesignNavIcon name="settings" size={16} />
          </button>
        </div>

        {/* Doc action buttons */}
        <div className={`${styles.docActions} doc-actions`}>
          <button
            type="button"
            className={`${styles.docActionBtn} doc-action-btn`}
            onClick={onCreateDoc}
          >
            <span className={`${styles.docActionIcon} ${styles.actionIconBlue}`}>
              <DesignNavIcon name="plus" size={16} />
            </span>
            新建
          </button>
          <button
            type="button"
            className={`${styles.docActionBtn} doc-action-btn`}
            onClick={onUploadDoc}
          >
            <span className={`${styles.docActionIcon} ${styles.actionIconOrange}`}>
              <DesignNavIcon name="upload" size={16} />
            </span>
            上传
          </button>
          <button
            type="button"
            className={`${styles.docActionBtn} doc-action-btn`}
            onClick={onTemplateLibrary}
          >
            <span className={`${styles.docActionIcon} ${styles.actionIconMulti}`}>
              <DesignNavIcon name="template" size={16} />
            </span>
            模板库
          </button>
        </div>

        {/* Doc tabs */}
        <div className={styles.docTabs}>
          {DOC_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`${styles.docTab} ${
                activeTab === tab.id ? styles.docTabActive : ''
              }`}
              onClick={() => onTabChange?.(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
          <button
            type="button"
            className={styles.docTabPlus}
            aria-label="更多标签"
            onClick={onPlusTab}
          >
            <DesignNavIcon name="plus" size={15} />
          </button>
        </div>

        {/* Doc table */}
        <div className={`${styles.docTable} doc-table`}>
          <div className={`${styles.docTableHead} doc-table-head`}>
            <span>标题</span>
            <span>位置</span>
            <span>所有者</span>
            <span>创建时间</span>
            <span />
          </div>
          {rows.map((doc) => (
            <DocTableRow key={doc.id} doc={doc} onClick={onDocClick} onDelete={onDeleteDoc} profiles={profiles} />
          ))}
        </div>
        {activePreview && (
          <section className={`${styles.previewPanel} doc-preview-panel`} data-card-surface>
            <div className={styles.previewHead}>
              <div>
                <span>{activePreview.sourceLabel}</span>
                <strong>{activePreview.name}</strong>
              </div>
              <em>轻量文档预览</em>
            </div>
            <FilePreview
              filename={activePreview.name}
              owner={activePreview.owner}
              language={activePreview.type}
              content={activePreview.content}
              diffContent={activePreview.diffContent}
              onClose={onClosePreview ?? (() => {})}
            />
          </section>
        )}
      </main>
    </section>
  );
}
