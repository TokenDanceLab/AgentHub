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
  onStartNewConversation,
  liveStatusByConversation,
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
    onStartNewConversation,
    liveStatusByConversation,
  });

  return (
    <div
      aria-hidden={sidebarCollapsed}
      className={styles.sidebarFrame}
      data-sidebar-frame
      /* #1823: collapsing only clipped the column, so the search box, sort
         select and conversation buttons stayed in the Tab order. `inert`
         removes the whole subtree from focus + AT, matching the CSS
         visibility gate on .sidebarFrame. */
      inert={sidebarCollapsed}
    >
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
 * Web adds the Preview aux surface only when normalized Hub evidence exists;
 * it never gains local workspace/host capabilities (#1966).
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
  const hasRuntimePreview = Boolean(
    props.runtimeEvidence?.artifacts?.length || props.runtimeEvidence?.previews?.length,
  );
  // Web remains Hub-only: it gets the normalized preview surface only when
  // Hub evidence exists; no Local Edge/file tabs or host URLs are invented.
  if (!localFiles && !hasRuntimePreview) return inspector;
  const workDir = resolveComposerWorkDir(props.session.composer?.workDir);
  const hasWorkspace = Boolean(workDir);
  return (
    <ChatEngineeringColumn
      inspector={inspector}
      hasWorkspace={hasWorkspace}
      localFiles={localFiles}
      conversationId={props.session.currentConversationId}
      runtimeEvidence={props.runtimeEvidence}
      platform={props.platform}
      inspectorCollapsed={props.inspectorCollapsed}
      {...(workDir ? { workDir } : {})}
    />
  );
}
