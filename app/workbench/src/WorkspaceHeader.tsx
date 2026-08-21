import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkbenchConversation } from '@shared/platform';
import { DesignNavIcon } from './designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { Tooltip } from '@shared/ui/Tooltip';
import styles from './AgentHubWorkbench.module.css';

export interface WorkspaceHeaderProps {
  activeConversation: WorkbenchConversation | undefined;
  inspectorCollapsed: boolean;
  onToggleInspector: () => void;
  /** Called when the user clicks the search icon. */
  onOpenSearch?: (() => void) | undefined;
}

export function WorkspaceHeader({
  activeConversation,
  inspectorCollapsed,
  onToggleInspector,
  onOpenSearch,
}: WorkspaceHeaderProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const initial = activeConversation?.avatarLabel ?? (activeConversation?.title ?? 'A').slice(0, 1);
  const hasModel = Boolean(activeConversation?.model);
  const runtimeLabel = activeConversation?.runtimeLabel ?? activeConversation?.subtitle;
  const threadLabel = activeConversation?.threadLabel
    ?? (activeConversation?.kind === 'group' ? '协作群' : '私聊');

  return (
    <header className={styles.workspaceHeader}>
      <div
        aria-hidden="true"
        className={styles.workspaceAvatar}
        style={{
          background:
            activeConversation?.avatarUrl ? undefined : (activeConversation?.avatarColor ?? 'var(--td-plum)'),
          color: activeConversation?.avatarTextColor,
        }}
      >
        {activeConversation?.avatarUrl ? (
          <img alt="" className={styles.workspaceAvatarImg} src={activeConversation.avatarUrl} />
        ) : (
          initial
        )}
      </div>

      <div className={styles.workspaceHeaderCopy}>
        <div className={styles.workspaceTitleRow}>
          <h1 className={styles.workspaceTitle}>
            {activeConversation?.title ?? 'AgentHub'}
          </h1>
          {runtimeLabel ? (
            <span className={styles.workspaceKind}>{runtimeLabel}</span>
          ) : null}
          <span className={styles.workspaceThread}>
            {threadLabel}
          </span>
          {hasModel ? (
            <span className={styles.workspaceModel}>{activeConversation?.model}</span>
          ) : null}
        </div>
      </div>

      {/* #1821: the tab row (消息/云文档/新建频道) and the 新任务/确认项/会话设置
          buttons had no onClick — nothing to navigate to or open. Removed
          instead of leaving dead chrome; shells that gain those capabilities
          should wire callbacks when re-adding them. */}
      <div className={styles.workspaceActions}>
        <Tooltip label={t('aria.search')}>
          <button
            aria-label={t('aria.search')}
            className={styles.iconButton}
            onClick={onOpenSearch}
            type="button"
          >
            <DesignNavIcon name="search" />
          </button>
        </Tooltip>
        <Tooltip label={inspectorCollapsed ? '展开右侧概览' : '收起右侧概览'}>
          <button
            aria-label={inspectorCollapsed ? t('aria.expandInspector') : t('aria.collapseInspector')}
            className={`${styles.iconButton} ${styles.inspectorToggleBtn}`}
            onClick={onToggleInspector}
            type="button"
          >
            <span className={styles.iconCollapse}><DesignNavIcon name="sidebarRight" /></span>
            <span className={styles.iconExpand}><DesignNavIcon name="sidebarLeft" /></span>
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
