import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkbenchConversation } from '../platform';
import { DesignNavIcon } from './designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';

export interface WorkspaceHeaderProps {
  activeConversation: WorkbenchConversation | undefined;
  dataMode?: string | undefined;
  inspectorCollapsed: boolean;
  onToggleInspector: () => void;
  /** Called when the user clicks the search icon. */
  onOpenSearch?: (() => void) | undefined;
}

export function WorkspaceHeader({
  activeConversation,
  dataMode,
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
  const dataModeValue = dataModeControlValue(dataMode);

  return (
    <header className={styles.workspaceHeader}>
      <div
        aria-hidden="true"
        className={styles.workspaceAvatar}
        style={{
          background:
            activeConversation?.avatarUrl ? undefined : (activeConversation?.avatarColor ?? 'var(--primary)'),
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

        <div aria-label={t('aria.workspaceTabs')} className={styles.workspaceTabs} role="tablist">
          <button
            aria-selected="true"
            className={styles.workspaceTab}
            data-workspace-tab="messages"
            role="tab"
            type="button"
          >
            <DesignNavIcon name="chat" />
            消息
          </button>
          <button
            aria-selected="false"
            className={styles.workspaceTab}
            data-workspace-tab="docs"
            role="tab"
            type="button"
          >
            <DesignNavIcon name="fileText" />
            云文档
          </button>
          <button
            aria-label={t('aria.newChannel')}
            className={`${styles.workspaceTab} ${styles.workspaceTabIconOnly}`}
            data-workspace-tab="new-channel"
            role="tab"
            type="button"
          >
            <DesignNavIcon name="plus" />
          </button>
        </div>
      </div>

      <div className={styles.workspaceActions}>
        <button
          aria-label={t('aria.search')}
          className={styles.iconButton}
          onClick={onOpenSearch}
          title="搜索"
          type="button"
        >
          <DesignNavIcon name="search" />
        </button>
        <button
          aria-label={t('aria.newTask')}
          className={styles.iconButton}
          title="新任务"
          type="button"
        >
          <DesignNavIcon name="template" />
        </button>
        <button
          aria-label={t('aria.confirmItems')}
          className={styles.iconButton}
          title="确认项"
          type="button"
        >
          <DesignNavIcon name="check" />
        </button>
        <button
          aria-label={t('aria.sessionSettings')}
          className={styles.iconButton}
          title="会话设置"
          type="button"
        >
          <DesignNavIcon name="settings" />
        </button>
        <button
          aria-label={inspectorCollapsed ? t('aria.expandInspector') : t('aria.collapseInspector')}
          className={`${styles.iconButton} ${styles.inspectorToggleBtn}`}
          onClick={onToggleInspector}
          title={inspectorCollapsed ? '展开右侧概览' : '收起右侧概览'}
          type="button"
        >
          <span className={styles.iconCollapse}><DesignNavIcon name="sidebarRight" /></span>
          <span className={styles.iconExpand}><DesignNavIcon name="sidebarLeft" /></span>
        </button>
      </div>
    </header>
  );
}

function dataModeControlValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? 'auto';
}
