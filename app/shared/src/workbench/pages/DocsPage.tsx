import React, { useCallback } from 'react';
import { DesignNavIcon, type DesignNavIconName } from '../designIcons';
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

  /** Called when a doc row is clicked */
  onDocClick?: ((doc: DocRow) => void) | undefined;

  /** Callbacks for action buttons */
  onCreateDoc?: (() => void) | undefined;
  onUploadDoc?: (() => void) | undefined;
  onTemplateLibrary?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  onPlusTab?: (() => void) | undefined;
  /** Called when a shortcut is clicked */
  onShortcutClick?: ((name: string) => void) | undefined;
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
      <DesignNavIcon name={name} size={17} />
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

const DOC_TABS: { id: DocsPane; label: string }[] = [
  { id: 'recent', label: '最近访问' },
  { id: 'owned', label: '归我所有' },
  { id: 'shared', label: '与我共享' },
  { id: 'starred', label: '收藏' },
];

// ── Sub-components ──

function DocTableRow({
  doc,
  onClick,
}: {
  doc: DocRow;
  onClick?: ((doc: DocRow) => void) | undefined;
}) {
  const handleClick = useCallback(() => {
    onClick?.(doc);
  }, [doc, onClick]);

  return (
    <button type="button" className={styles.docRow} onClick={handleClick}>
      <span className={styles.docTitle}>
        <span className={styles.docType}>
          <DesignNavIcon name="fileText" size={14} />
        </span>
        {doc.title}
        {doc.tag && <em className={styles.docTag}>{doc.tag}</em>}
      </span>
      <span>{doc.location}</span>
      <span>{doc.owner}</span>
      <span>{doc.time}</span>
      <span className={styles.docMore}>
        <DesignNavIcon name="more" size={14} />
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
  onDocClick,
  onCreateDoc,
  onUploadDoc,
  onTemplateLibrary,
  onSettings,
  onPlusTab,
  onShortcutClick,
}: DocsPageProps): React.ReactElement {
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
    <section className={styles.page}>
      {/* ── Left nav ── */}
      <aside className={styles.nav}>
        <div className={styles.navTitle}>云文档</div>
        <input
          className={styles.search}
          placeholder="搜索"
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
      <main className={styles.main}>
        {/* Head */}
        <div className={styles.head}>
          <h1 className={styles.headTitle}>主页</h1>
          <button
            type="button"
            className={styles.iconAction}
            aria-label="云文档设置"
            onClick={onSettings}
          >
            <DesignNavIcon name="settings" size={16} />
          </button>
        </div>

        {/* Doc action buttons */}
        <div className={styles.docActions}>
          <button
            type="button"
            className={styles.docActionBtn}
            onClick={onCreateDoc}
          >
            <span className={`${styles.docActionIcon} ${styles.actionIconBlue}`}>
              <DesignNavIcon name="plus" size={16} />
            </span>
            新建
          </button>
          <button
            type="button"
            className={styles.docActionBtn}
            onClick={onUploadDoc}
          >
            <span className={`${styles.docActionIcon} ${styles.actionIconOrange}`}>
              <DesignNavIcon name="upload" size={16} />
            </span>
            上传
          </button>
          <button
            type="button"
            className={styles.docActionBtn}
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
              {tab.label}
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
        <div className={styles.docTable}>
          <div className={styles.docTableHead}>
            <span>标题</span>
            <span>位置</span>
            <span>所有者</span>
            <span>创建时间</span>
            <span />
          </div>
          {rows.map((doc) => (
            <DocTableRow key={doc.id} doc={doc} onClick={onDocClick} />
          ))}
        </div>
      </main>
    </section>
  );
}
