import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../i18n';
import { DesignNavIcon } from '../designIcons';
import styles from './DocsPage.module.css';
import {
  DEFAULT_SHORTCUTS,
  DOC_TABS,
  DocPreviewPanel,
  DocTable,
  DocsNav,
} from './docs';
import type { DocsPageProps } from './docs';

/* ═══════════════════════════════════════════════════════════════════════
   DocsPage — pure presentational workbench page

   Subcomponents / types extracted under ./docs for Phase 19 #582.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export type {
  DocRow,
  DocsPane,
  DocsPageNavItem,
  DocsPageProps,
} from './docs';

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

  return (
    <section className={`${styles.page} workbench docs-page`}>
      <DocsNav
        activeNav={activeNav}
        onNavChange={onNavChange}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        navItems={navItems}
        shortcuts={shortcuts}
        onShortcutClick={onShortcutClick}
      />

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

        <DocTable
          rows={rows}
          profiles={profiles}
          onDocClick={onDocClick}
          onDeleteDoc={onDeleteDoc}
          onCreateDoc={onCreateDoc}
        />
        {activePreview && (
          <DocPreviewPanel
            activePreview={activePreview}
            onClosePreview={onClosePreview}
          />
        )}
      </main>
    </section>
  );
}
