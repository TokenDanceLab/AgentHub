/* ==========================================================================
   SplitConversationPane — read-only pane for an inactive split group
   (#1997, UX F3).

   Renders the cached transcript snapshot of a non-active conversation in
   read-only mode (no composer, no block actions — single-active-session
   contract: only the active pane receives composer/shortcuts). The pane
   header offers focus (make it the active conversation), Move to Group and
   close-pane controls.
   ========================================================================== */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkbenchConversation } from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { ChatViewBridge } from './ChatViewBridge';
import { DesignNavIcon } from './designIcons';
import { ContextMenu, type ContextMenuItem } from './floating/ContextMenu';
import type { ConversationLiveStatus } from './workbenchAttentionModel';
import type { WorkbenchSplitControls } from './workbenchFrameTypes';
import styles from './AgentHubWorkbench.module.css';

/** Stable empty id-sets: read-only panes never select/hide/pulse blocks. */
const EMPTY_ID_SET: Set<string> = new Set<string>();

export interface SplitConversationPaneProps {
  paneId: string;
  /** Conversation metadata; absent when the referenced id is unknown. */
  conversation: WorkbenchConversation | undefined;
  /** Cached transcript snapshot; empty until the conversation was visited. */
  transcript: TranscriptBlock[];
  liveStatus?: ConversationLiveStatus | undefined;
  /** Move-to-Group targets + close wiring for this pane. */
  splitControls?: WorkbenchSplitControls | undefined;
  /** Make this pane's conversation the active one. */
  onFocus: () => void;
  /** Close (unsplit) this pane. */
  onClose: () => void;
}

export function SplitConversationPane({
  paneId,
  conversation,
  transcript,
  liveStatus,
  splitControls,
  onFocus,
  onClose,
}: SplitConversationPaneProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const title = conversation?.title ?? paneId;
  const initial = conversation?.avatarLabel ?? title.slice(0, 1);

  const handleContextMenu = useCallback((event: React.MouseEvent): void => {
    if (!splitControls) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  }, [splitControls]);

  const menuGroups = useCallback((): Array<Array<ContextMenuItem>> => {
    if (!splitControls) return [];
    const groups: Array<Array<ContextMenuItem>> = [
      [{ icon: 'preview', label: t('split.focusPane'), onClick: onFocus }],
    ];
    if (splitControls.moveTargets.length > 0) {
      groups.push([{
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
      }]);
    }
    groups.push([{ icon: 'close', label: t('split.closePane'), onClick: onClose }]);
    return groups;
  }, [splitControls, t, onFocus, onClose]);

  return (
    <div className={styles.splitPaneBody} data-split-pane-id={paneId} onContextMenu={handleContextMenu}>
      <div className={styles.splitPaneHeader}>
        <button
          className={styles.splitPaneTitleButton}
          data-testid="split-pane-focus"
          title={t('split.focusPane')}
          type="button"
          onClick={onFocus}
        >
          <span
            aria-hidden="true"
            className={styles.splitPaneAvatar}
            style={{
              background: conversation?.avatarUrl ? undefined : (conversation?.avatarColor ?? 'var(--td-plum)'),
              color: conversation?.avatarTextColor,
            }}
          >
            {conversation?.avatarUrl ? (
              <img alt="" className={styles.workspaceAvatarImg} src={conversation.avatarUrl} />
            ) : (
              initial
            )}
          </span>
          <span className={styles.splitPaneTitle}>{title}</span>
          {liveStatus ? (
            <span
              className={styles.splitLiveDot}
              data-live-status={liveStatus}
              aria-hidden="true"
            />
          ) : null}
          <span className={styles.splitReadOnlyBadge}>{t('split.readOnly')}</span>
        </button>
        <button
          aria-label={t('split.closePane')}
          className={styles.iconButton}
          data-testid="split-pane-close"
          type="button"
          onClick={onClose}
        >
          <DesignNavIcon name="close" />
        </button>
      </div>
      <div className={styles.splitPaneTranscript}>
        {transcript.length === 0 ? (
          <div className={styles.splitPaneEmpty} data-testid="split-pane-empty">
            {t('split.paneEmpty')}
          </div>
        ) : (
          <ChatViewBridge
            displayTranscript={transcript}
            {...(conversation ? { activeConversation: conversation } : {})}
            selectedBlockIds={EMPTY_ID_SET}
            selectionMode={false}
            softHiddenBlockIds={EMPTY_ID_SET}
            actionedBlockIds={EMPTY_ID_SET}
            dismissedPinnedIds={EMPTY_ID_SET}
          />
        )}
      </div>
      {splitControls ? (
        <ContextMenu
          isOpen={menu !== null}
          groups={menuGroups()}
          title={title}
          subtitle={t('split.menuSubtitle')}
          x={menu?.x ?? 0}
          y={menu?.y ?? 0}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
