import React from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { WorkbenchConversation } from '../platform';
import styles from './AgentHubWorkbench.module.css';

const workspaceTabs = ['消息', '云文档'] as const;

export interface WorkspaceHeaderProps {
  activeConversation: WorkbenchConversation | undefined;
  browserPreviewEnabled: boolean;
  inspectorCollapsed: boolean;
  onToggleInspector: () => void;
}

export function WorkspaceHeader({
  activeConversation,
  browserPreviewEnabled,
  inspectorCollapsed,
  onToggleInspector,
}: WorkspaceHeaderProps): React.ReactElement {
  const InspectorIcon = inspectorCollapsed ? PanelRightOpen : PanelRightClose;

  return (
    <header className={styles.workspaceHeader}>
      <div className={styles.workspaceAvatar} aria-hidden="true">
        {(activeConversation?.title ?? 'A').slice(0, 1)}
      </div>
      <div className={styles.workspaceHeaderCopy}>
        <div className={styles.workspaceTitleRow}>
          <h1 className={styles.workspaceTitle}>{activeConversation?.title ?? 'AgentHub'}</h1>
          {activeConversation?.subtitle ? (
            <span className={styles.workspaceKind}>{activeConversation.subtitle}</span>
          ) : null}
          <span className={styles.workspaceThread}>
            {activeConversation?.kind === 'group' ? '协作群' : '私聊'}
          </span>
        </div>
        <div aria-label="Workspace tabs" className={styles.workspaceTabs} role="tablist">
          {workspaceTabs.map((tab, index) => (
            <button
              aria-selected={index === 0}
              className={styles.workspaceTab}
              key={tab}
              role="tab"
              type="button"
            >
              {tab}
            </button>
          ))}
          <button aria-label="新建频道" className={styles.workspaceTab} role="tab" type="button">
            +
          </button>
        </div>
      </div>
      <div className={styles.workspaceActions}>
        <button
          aria-label={inspectorCollapsed ? '展开右侧概览' : '收起右侧概览'}
          className={styles.iconButton}
          onClick={onToggleInspector}
          title={inspectorCollapsed ? '展开右侧概览' : '收起右侧概览'}
          type="button"
        >
          <InspectorIcon aria-hidden="true" />
        </button>
        <button
          className={styles.previewButton}
          disabled={!browserPreviewEnabled}
          type="button"
        >
          浏览器预览
        </button>
      </div>
    </header>
  );
}
