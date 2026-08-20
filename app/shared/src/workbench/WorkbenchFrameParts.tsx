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
} from './WorkbenchFrameChromeParts';
import {
  buildChatInspectorProps,
  buildConversationSidebarProps,
  buildWorkbenchRoutesProps,
  useBuildChatConversationHostProps,
} from './workbenchFramePartsHelpers';
import { resolveComposerWorkDir } from './workbenchFrameHelpers';
import { PageErrorBoundary } from './PageErrorBoundary';
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
  // Hook form stabilizes per-render derived props (block event adapters +
  // id Sets) so ConversationHost/ChatViewBridge memo gates hold (#perf).
  return <ConversationHost {...useBuildChatConversationHostProps(props)} />;
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
  const inspector = (
    <PageErrorBoundary>
      <RightInspector {...buildChatInspectorProps(props)} />
    </PageErrorBoundary>
  );
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
