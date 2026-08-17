/* ═══════════════════════════════════════════════════════════════════════
   Docs table / preview subviews — extracted for Phase 19 #582.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
import { DesignNavIcon } from '../../designIcons';
import type { WorkbenchDocumentPreview } from '../../documentPreview';
import { FilePreview } from '../../inspector';
import {
  resolveWorkbenchProfile,
  type WorkbenchProfileSource,
} from '../../profileRegistry';
import { EmptyState } from '../../../ui';
import { SkeletonBar } from '../../../ui/SkeletonBar';
import { Tooltip } from '../../../ui/Tooltip';
import styles from '../DocsPage.module.css';
import type { DocRow } from './types';

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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
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
          <Tooltip label={t("aria.deleteDoc")}>
            <button type="button" className={styles.docDeleteBtn} onClick={handleDelete} aria-label={t("aria.deleteDoc")}>
              <DesignNavIcon name="close" size={14} />
            </button>
          </Tooltip>
        ) : (
          <DesignNavIcon name="more" size={14} />
        )}
      </span>
    </button>
  );
}

export function DocTable({
  rows,
  documentsLoading,
  profiles,
  onDocClick,
  onDeleteDoc,
  onCreateDoc,
}: {
  rows: DocRow[];
  documentsLoading?: boolean;
  profiles?: WorkbenchProfileSource[] | undefined;
  onDocClick?: ((doc: DocRow) => void) | undefined;
  onDeleteDoc?: ((documentId: string) => Promise<unknown> | void) | undefined;
  onCreateDoc?: (() => void) | undefined;
}) {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  return (
    <div className={`${styles.docTable} doc-table`}>
      <div className={`${styles.docTableHead} doc-table-head`}>
        <span>标题</span>
        <span>位置</span>
        <span>所有者</span>
        <span>打开时间</span>
        <span />
      </div>
      {documentsLoading && rows.length === 0 ? (
        // Loading state: real-mode documents still fetching (undefined).
        // Show shimmering placeholder rows instead of the empty "暂无文档"
        // copy so users do not mistake a load-in-progress for an empty list.
        <div className="doc-table-skeleton" role="status" aria-label={t('docs.loading', '加载中…')}>
          {Array.from({ length: 4 }, (_, index) => (
            <div className={`${styles.docRow} doc-row`} key={`skeleton-${index}`} aria-hidden="true">
              <span className={styles.docTitle}>
                <span className={styles.docType}>
                  <DesignNavIcon name="fileText" size={14} />
                </span>
                <SkeletonBar width="42%" height="1em" />
              </span>
              <span><SkeletonBar width="26%" height="1em" /></span>
              <span className={styles.ownerPill} data-profile-kind="user">
                <span className={styles.ownerAvatar} style={{ '--owner-avatar-color': 'var(--muted)' } as React.CSSProperties}>
                  {' '}
                </span>
                <span><SkeletonBar width="3.6em" height="1em" /></span>
              </span>
              <span><SkeletonBar width="4.2em" height="1em" /></span>
              <span className={styles.docMore} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('docs.empty.title')}
          description={t('docs.empty.description')}
          titleLevel={3}
          {...(styles['docs-empty-compact']
            ? { className: styles['docs-empty-compact'] }
            : {})}
          {...(styles['docs-empty-compact-content']
            ? { contentClassName: styles['docs-empty-compact-content'] }
            : {})}
          {...(styles['docs-empty-compact-title']
            ? { titleClassName: styles['docs-empty-compact-title'] }
            : {})}
          {...(styles['docs-empty-compact-description']
            ? { descriptionClassName: styles['docs-empty-compact-description'] }
            : {})}
          {...(styles['docs-empty-compact-action']
            ? { actionClassName: styles['docs-empty-compact-action'] }
            : {})}
          {...(onCreateDoc
            ? { action: { label: t('docs.newDoc'), onClick: onCreateDoc } }
            : {})}
        />
      ) : (
        rows.map((doc) => (
          <DocTableRow
            key={doc.id}
            doc={doc}
            onClick={onDocClick}
            onDelete={onDeleteDoc ? () => onDeleteDoc(doc.id) : undefined}
            profiles={profiles}
          />
        ))
      )}
    </div>
  );
}

export function DocPreviewPanel({
  activePreview,
  onClosePreview,
}: {
  activePreview: WorkbenchDocumentPreview;
  onClosePreview?: (() => void) | undefined;
}) {
  return (
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
  );
}
