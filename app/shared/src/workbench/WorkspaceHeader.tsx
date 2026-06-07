import React from 'react';
import type { WorkbenchConversation } from '../platform';
import { DesignNavIcon } from './designIcons';
import styles from './AgentHubWorkbench.module.css';

export interface WorkspaceHeaderProps {
  activeConversation: WorkbenchConversation | undefined;
  inspectorCollapsed: boolean;
  onToggleInspector: () => void;
}

export function WorkspaceHeader({
  activeConversation,
  inspectorCollapsed,
  onToggleInspector,
}: WorkspaceHeaderProps): React.ReactElement {
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
            activeConversation?.avatarColor ?? 'var(--primary)',
          color: activeConversation?.avatarTextColor,
        }}
      >
        {initial}
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
            <span className={styles.workspaceModel}>{activeConversation!.model}</span>
          ) : null}
        </div>

        <div aria-label="Workspace tabs" className={styles.workspaceTabs} role="tablist">
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
            aria-label="新建频道"
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
          aria-label="搜索"
          className={styles.iconButton}
          title="搜索"
          type="button"
        >
          <DesignNavIcon name="search" />
        </button>
        <button
          aria-label="新任务"
          className={styles.iconButton}
          title="新任务"
          type="button"
        >
          <DesignNavIcon name="template" />
        </button>
        <button
          aria-label="确认项"
          className={styles.iconButton}
          title="确认项"
          type="button"
        >
          <DesignNavIcon name="check" />
        </button>
        <button
          aria-label="会话设置"
          className={styles.iconButton}
          title="会话设置"
          type="button"
        >
          <DesignNavIcon name="settings" />
        </button>
        <button
          aria-label={inspectorCollapsed ? '展开右侧概览' : '收起右侧概览'}
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
