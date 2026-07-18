import React from 'react';
import type {
  ChatConversationHostFrameProps,
  ChatInspectorFrameProps,
  ChatSidebarFrameProps,
  WorkbenchRoutesFrameProps,
} from './workbenchFrameTypes';
import { ConversationHost } from './ConversationHost';
import { ConversationSidebar } from './ConversationSidebar';
import { RightInspector } from './RightInspector';
import { ChatEngineeringColumn } from './ChatEngineeringColumn';
import { WorkbenchRoutes } from './WorkbenchRoutes';
import {
  SidebarResizer,
  WorkbenchPageHost,
  WorkspaceLoadErrorState,
  WorkspaceLoadingState,
} from './WorkbenchFrameChromeParts';
import {
  buildChatConversationHostProps,
  buildChatInspectorProps,
  buildConversationSidebarProps,
  buildWorkbenchRoutesProps,
} from './workbenchFramePartsHelpers';
import { resolveComposerWorkDir } from './workbenchFrameHelpers';
import styles from './AgentHubWorkbench.module.css';

export {
  WorkspaceLoadErrorState,
  WorkspaceLoadingState,
} from './WorkbenchFrameChromeParts';

/* ==========================================================================
   WorkbenchFrameParts -- presentational residual slices from WorkbenchFrame
   (#637). Prop contracts in workbenchFrameTypes (#698). Residual builders /
   chrome parts in workbenchFramePartsHelpers + WorkbenchFrameChromeParts
   (#742). No intentional UX change.
   ========================================================================== */

/** Conversation list + vertical sidebar resizer for chat page. */
export function ChatSidebarFrame({
  conversations,
  currentConversationId,
  onSelectConversation,
  onAvatarClick,
  onConversationPin,
  onConversationArchive,
  sidebarWidth,
  sidebarCollapsed,
  resizeSidebarBy,
  beginSidebarResize,
}: ChatSidebarFrameProps): React.ReactElement {
  const sidebarProps = buildConversationSidebarProps({
    conversations,
    currentConversationId,
    onSelectConversation,
    onAvatarClick,
    onConversationPin,
    onConversationArchive,
  });

  return (
    <div className={styles.sidebarFrame}>
      <ConversationSidebar {...sidebarProps} />
      <SidebarResizer
        beginSidebarResize={beginSidebarResize}
        resizeSidebarBy={resizeSidebarBy}
        sidebarCollapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidth}
      />
    </div>
  );
}

/** ConversationHost wiring for chat page -- pure prop mapping. */
export function ChatConversationHostFrame(
  props: ChatConversationHostFrameProps,
): React.ReactElement {
  return <ConversationHost {...buildChatConversationHostProps(props)} />;
}

/** Non-chat page host wrapping WorkbenchRoutes. */
export function WorkbenchRoutesFrame(
  props: WorkbenchRoutesFrameProps,
): React.ReactElement {
  return (
    <WorkbenchPageHost>
      <WorkbenchRoutes {...buildWorkbenchRoutesProps(props)} />
    </WorkbenchPageHost>
  );
}

/**
 * RightInspector host for chat page.
 * When `platform.capabilities.localFiles` (Desktop), stacks AuxPanel below
 * the inspector for the local engineering-loop chrome (#1181).
 * Web keeps RightInspector only.
 */
export function ChatInspectorFrame(
  props: ChatInspectorFrameProps,
): React.ReactElement {
  const inspector = <RightInspector {...buildChatInspectorProps(props)} />;
  const localFiles = Boolean(props.platform.capabilities.localFiles);
  if (!localFiles) {
    return inspector;
  }
  const workDir = resolveComposerWorkDir(props.session.composer?.workDir);
  const hasWorkspace = Boolean(workDir);
  return (
    <ChatEngineeringColumn
      inspector={inspector}
      hasWorkspace={hasWorkspace}
      localFiles={localFiles}
      platform={props.platform}
      {...(workDir ? { workDir } : {})}
    />
  );
}
