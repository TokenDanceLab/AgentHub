import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkbenchConversation } from '@shared/platform';
import { DesignNavIcon } from './designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { Tooltip } from '@shared/ui/Tooltip';
import { ContextMenu, type ContextMenuItem } from './floating/ContextMenu';
import type { WorkbenchSplitControls } from './workbenchFrameTypes';
import styles from './AgentHubWorkbench.module.css';

export interface WorkspaceHeaderProps {
  activeConversation: WorkbenchConversation | undefined;
  inspectorCollapsed: boolean;
  onToggleInspector: () => void;
  /** Called when the user clicks the search icon. */
  onOpenSearch?: (() => void) | undefined;
  /**
   * Split-view controls (#1997, UX F3). Absent when the honesty gate hides
   * the surface (fewer than two conversations) — no split entry renders.
   */
  splitControls?: WorkbenchSplitControls | undefined;
}

interface SplitMenuState {
  x: number;
  y: number;
}

export function WorkspaceHeader({
  activeConversation,
  inspectorCollapsed,
  onToggleInspector,
  onOpenSearch,
  splitControls,
}: WorkspaceHeaderProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [splitMenu, setSplitMenu] = useState<SplitMenuState | null>(null);
  const splitButtonRef = useRef<HTMLButtonElement>(null);
  const initial = activeConversation?.avatarLabel ?? (activeConversation?.title ?? 'A').slice(0, 1);
  const hasModel = Boolean(activeConversation?.model);
  const runtimeLabel = activeConversation?.runtimeLabel ?? activeConversation?.subtitle;
  const threadLabel = activeConversation?.threadLabel
    ?? (activeConversation?.kind === 'group' ? '协作群' : '私聊');

  const closeSplitMenu = useCallback((): void => setSplitMenu(null), []);

  const openSplitMenuFromButton = useCallback((): void => {
    const rect = splitButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSplitMenu({ x: rect.right, y: rect.bottom + 4 });
  }, []);

  const handleHeaderContextMenu = useCallback((event: React.MouseEvent): void => {
    if (!splitControls) return;
    event.preventDefault();
    setSplitMenu({ x: event.clientX, y: event.clientY });
  }, [splitControls]);

  // Split view context menu (#1997): Split Right / Split Down always offered;
  // Move to Group + Unsplit only while a split is active (flow convergence).
  const splitMenuGroups = useCallback((): Array<Array<ContextMenuItem>> => {
    if (!splitControls) return [];
    const layoutGroup: ContextMenuItem[] = [];
    if (splitControls.onSplitRight) {
      layoutGroup.push({ icon: 'split', label: t('split.right'), onClick: splitControls.onSplitRight });
    }
    if (splitControls.onSplitDown) {
      layoutGroup.push({ icon: 'download', label: t('split.down'), onClick: splitControls.onSplitDown });
    }
    if (!splitControls.hasSplit) return layoutGroup.length > 0 ? [layoutGroup] : [];
    const moveGroup: ContextMenuItem[] = [];
    if (splitControls.moveTargets.length > 0) {
      moveGroup.push({
        icon: 'forward',
        label: t('split.moveToGroup'),
        chevron: true,
        submenu: (close) => (
          <div role="group" aria-label={t('split.moveToGroup')}>
            {splitControls.moveTargets.map((target) => (
              <button
                key={target.paneId}
                className={styles.splitMoveTarget}
                role="menuitem"
                type="button"
                title={target.title}
                onClick={() => {
                  splitControls.onMoveToPane(target.paneId);
                  close();
                }}
              >
                {target.title}
              </button>
            ))}
          </div>
        ),
      });
    }
    moveGroup.push({ icon: 'close', label: t('split.unsplit'), onClick: splitControls.onUnsplit });
    return [layoutGroup, moveGroup];
  }, [splitControls, t]);

  return (
    <header className={styles.workspaceHeader} onContextMenu={handleHeaderContextMenu}>
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
          <h1 className={styles.workspaceTitle} title={activeConversation?.title}>
            {activeConversation?.title ?? 'AgentHub'}
          </h1>
          {runtimeLabel ? (
            <span className={styles.workspaceKind} title={runtimeLabel}>{runtimeLabel}</span>
          ) : null}
          <span className={styles.workspaceThread} title={threadLabel}>
            {threadLabel}
          </span>
          {hasModel ? (
            <span className={styles.workspaceModel} title={activeConversation?.model}>{activeConversation?.model}</span>
          ) : null}
        </div>
      </div>

      {/* #1821: the tab row (消息/云文档/新建频道) and the 新任务/确认项/会话设置
          buttons had no onClick — nothing to navigate to or open. Removed
          instead of leaving dead chrome; shells that gain those capabilities
          should wire callbacks when re-adding them. */}
      <div className={styles.workspaceActions}>
        {splitControls ? (
          <Tooltip label={t('aria.splitMenu')}>
            <button
              ref={splitButtonRef}
              aria-haspopup="menu"
              aria-expanded={splitMenu !== null}
              aria-label={t('aria.splitMenu')}
              className={styles.iconButton}
              data-testid="workbench-split-menu"
              onClick={openSplitMenuFromButton}
              type="button"
            >
              <DesignNavIcon name="split" />
            </button>
          </Tooltip>
        ) : null}
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
      {splitControls ? (
        <ContextMenu
          isOpen={splitMenu !== null}
          groups={splitMenuGroups()}
          title={t('split.menuTitle')}
          subtitle={t('split.menuSubtitle')}
          x={splitMenu?.x ?? 0}
          y={splitMenu?.y ?? 0}
          onClose={closeSplitMenu}
        />
      ) : null}
    </header>
  );
}
