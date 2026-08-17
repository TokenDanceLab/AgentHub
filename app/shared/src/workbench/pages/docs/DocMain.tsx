/* ═══════════════════════════════════════════════════════════════════════
   Docs main pane cluster — head, action buttons, tabs, table, preview.

   Extracted from DocsPage as Phase 21 residual thin #605.
   CSS remains on shared DocsPage.module.css.
   EmptyState contracts stay in DocTable (titleLevel, optional class spreads, CTA).
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
import { DesignNavIcon } from '../../designIcons';
import styles from '../DocsPage.module.css';
import { DocPreviewPanel, DocTable } from './DocTableViews';
import { DOC_TABS } from './shared';
import type { DocsPageProps } from './types';

export type DocMainProps = Pick<
  DocsPageProps,
  | 'activeTab'
  | 'onTabChange'
  | 'rows'
  | 'documentsLoading'
  | 'profiles'
  | 'activePreview'
  | 'onDocClick'
  | 'onClosePreview'
  | 'onCreateDoc'
  | 'onUploadDoc'
  | 'onTemplateLibrary'
  | 'onSettings'
  | 'onPlusTab'
  | 'onDeleteDoc'
>;

export function DocMain({
  activeTab,
  onTabChange,
  rows,
  documentsLoading,
  profiles,
  activePreview,
  onDocClick,
  onClosePreview,
  onCreateDoc,
  onUploadDoc,
  onTemplateLibrary,
  onSettings,
  onPlusTab,
  onDeleteDoc,
}: DocMainProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  return (
    <main className={`${styles.main} workbench-main`}>
      {/* Head */}
      <div className={`${styles.head} workbench-head`}>
        <h1 className={styles.headTitle}>主页</h1>
        <button
          type="button"
          className={`${styles.iconAction} icon-action`}
          aria-label={t("aria.docSettings")}
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
          aria-label={t("aria.moreTags")}
          onClick={onPlusTab}
        >
          <DesignNavIcon name="plus" size={15} />
        </button>
      </div>

      <DocTable
        rows={rows}
        documentsLoading={documentsLoading ?? false}
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
  );
}
