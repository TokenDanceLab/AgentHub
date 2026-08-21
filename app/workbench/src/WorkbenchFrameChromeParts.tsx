import React from 'react';
import { useTranslation } from 'react-i18next';
import { RecoveryPanel } from '@shared/ui';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { DesignNavIcon } from './designIcons';
import type {
  WorkspaceLoadErrorStateProps,
  WorkspaceLoadingStateProps,
} from './workbenchFrameTypes';
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './workbenchLayoutConstants';
import {
  createVerticalResizerKeyDownHandler,
  createVerticalResizerPointerDownHandler,
} from './workbenchFrameHelpers';
import styles from './AgentHubWorkbench.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   WorkbenchFrameChromeParts — presentational residual slices from
   WorkbenchFrameParts (#742).

   Loading state, load-error recovery, sidebar resizer, and non-chat page
   host chrome. CSS remains on shared AgentHubWorkbench.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export function WorkspaceLoadingState({
  label,
}: WorkspaceLoadingStateProps): React.ReactElement {
  return (
    <div className={styles.workspaceLoading} role="status">
      <span className={styles.workspaceLoadingSpinner} />
      <span className={styles.workspaceLoadingLabel}>{label}</span>
    </div>
  );
}

/** Primary chat shell recovery when workbenchStatus.loadError is set (#1010). */
export function WorkspaceLoadErrorState({
  title,
  description,
  meta,
  retryLabel,
  onRetry,
}: WorkspaceLoadErrorStateProps): React.ReactElement {
  return (
    <div className={styles.workspaceLoadError}>
      <RecoveryPanel
        icon={<DesignNavIcon name="error404" size={18} />}
        eyebrow="Chat recovery"
        title={title}
        description={description}
        {...(meta ? { meta } : {})}
        primaryAction={{
          label: retryLabel,
          icon: <DesignNavIcon name="refresh" size={14} />,
          onClick: () => {
            if (onRetry) {
              onRetry();
              return;
            }
            if (typeof window !== 'undefined') {
              window.location.reload();
            }
          },
        }}
      />
    </div>
  );
}

export interface SidebarResizerProps {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  resizeSidebarBy: (delta: number) => void;
  beginSidebarResize: (clientX: number) => void;
}

/** Vertical resizer for the chat conversation sidebar. */
export function SidebarResizer({
  sidebarWidth,
  sidebarCollapsed,
  resizeSidebarBy,
  beginSidebarResize,
}: SidebarResizerProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const onKeyDown = createVerticalResizerKeyDownHandler(resizeSidebarBy);
  const onPointerDown = createVerticalResizerPointerDownHandler(
    sidebarCollapsed,
    beginSidebarResize,
  );

  return (
    <div
      aria-label={t('aria.resizeSidebar')}
      aria-orientation="vertical"
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuenow={sidebarWidth}
      className={styles.sidebarResizer}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      role="separator"
      tabIndex={sidebarCollapsed ? -1 : 0}
    />
  );
}

export interface WorkbenchPageHostProps {
  children: React.ReactNode;
}

/** Non-chat page host section chrome. */
export function WorkbenchPageHost({
  children,
}: WorkbenchPageHostProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);

  return (
    <section aria-label={t('aria.workbenchPage')} className={styles.workbenchPageHost}>
      {children}
    </section>
  );
}
