import { useMemo } from 'react';
import type { ConversationHostProps } from './ConversationHost';
import type { ConversationSidebarProps } from './ConversationSidebar';
import type { RightInspectorProps } from './rightInspectorTypes';
import type { WorkbenchRoutesProps } from './workbenchRoutesTypes';
import type {
  ChatConversationHostFrameProps,
  ChatInspectorFrameProps,
  ChatSidebarFrameProps,
  WorkbenchRoutesFrameProps,
} from './workbenchFrameTypes';
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
} from './workbenchLayoutConstants';
import {
  DEFAULT_BROWSER_PREVIEW_URL,
  assignIfDefined,
  createTranscriptBlockContextMenuHandler,
  createTranscriptBlockSelectHandler,
  resolveComposerWorkDir,
  toIdSet,
} from './workbenchFrameHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchFramePartsHelpers — pure residual slices from WorkbenchFrameParts
   (#742).

   Child-prop builders for sidebar / conversation host / routes / inspector
   frames. Pure builders are hook-free; useBuildChatConversationHostProps is
   the hook form for the chat host frame that stabilizes per-render derived
   values so the ConversationHost / ChatViewBridge memo gates hold.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined.
   ═══════════════════════════════════════════════════════════════════════ */

export function buildConversationSidebarProps(
  props: Pick<
    ChatSidebarFrameProps,
    | 'conversations'
    | 'currentConversationId'
    | 'onSelectConversation'
    | 'onAvatarClick'
    | 'onConversationPin'
    | 'onConversationArchive'
    | 'onStartNewConversation'
    | 'liveStatusByConversation'
  >,
): ConversationSidebarProps {
  const sidebarProps: ConversationSidebarProps = {
    activeConversationId: props.currentConversationId,
    conversations: props.conversations,
  };
  assignIfDefined(sidebarProps, 'onSelectConversation', props.onSelectConversation);
  assignIfDefined(sidebarProps, 'onAvatarClick', props.onAvatarClick);
  assignIfDefined(sidebarProps, 'onPinConversation', props.onConversationPin);
  assignIfDefined(sidebarProps, 'onArchiveConversation', props.onConversationArchive);
  assignIfDefined(sidebarProps, 'onStartNewConversation', props.onStartNewConversation);
  assignIfDefined(sidebarProps, 'liveStatusByConversation', props.liveStatusByConversation);
  return sidebarProps;
}

/**
 * Referentially stable host props. The frame-level hook (below) memoizes the
 * per-render derived values (block event adapters + id Sets) and hands them to
 * the pure builder so its default fresh-creation path is skipped.
 */
export interface ChatConversationHostStableOverrides {
  onBlockContextMenu: ConversationHostProps['onBlockContextMenu'];
  onBlockSelect: ConversationHostProps['onBlockSelect'];
  selectedBlockIds: ConversationHostProps['selectedBlockIds'];
  softHiddenBlockIds: ConversationHostProps['softHiddenBlockIds'];
  actionedBlockIds: ConversationHostProps['actionedBlockIds'];
}

export function buildChatConversationHostProps(
  props: ChatConversationHostFrameProps,
  stable?: ChatConversationHostStableOverrides,
): ConversationHostProps {
  const {
    platform,
    session,
    transcriptChrome,
    profile,
    transcript,
    transcriptUnreadDivider,
    connectionStatus,
    inspectorCollapsed,
    toggleInspector,
    workbenchStatus,
    composerExecutionTargets,
    showComposerAgentPicker,
    showComposerStatus,
    highlightedBlockId,
    onHighlightEnd,
    transcriptLoading,
  } = props;  const {
    currentConversationId,
    activeConversation,
    selectedExecutionTargetId,
    setSelectedExecutionTargetId,
    dismissedPinnedIds,
    searchOpen,
    setSearchOpen,
    composerInputRef,
    composer,
    dispatchComposer,
    mentionableAgents,
    openReviewFile,
    handleDeploySubmit,
  } = session;
  const {
    selectionMode,
    selectedBlockIds,
    softHiddenBlockIds,
    actionedBlockIds,
    showWorkbenchToast,
    openBlockContextMenu,
    handleBlockSelect,
    handleTranscriptBlockAction,
  } = transcriptChrome;
  const { openAgentProfile } = profile;

  const hostProps: ConversationHostProps = {
    transcript,
    inspectorCollapsed,
    onToggleInspector: toggleInspector,
    onAgentClick: openAgentProfile,
    onBlockContextMenu: stable?.onBlockContextMenu
      ?? createTranscriptBlockContextMenuHandler(transcript, openBlockContextMenu),
    onBlockSelect: stable?.onBlockSelect
      ?? createTranscriptBlockSelectHandler(handleBlockSelect),
    onBlockAction: handleTranscriptBlockAction,
    onReviewFile: openReviewFile,
    onDeploySubmit: handleDeploySubmit,
    selectedBlockIds: stable?.selectedBlockIds ?? toIdSet(selectedBlockIds),
    selectionMode,
    softHiddenBlockIds: stable?.softHiddenBlockIds ?? toIdSet(softHiddenBlockIds),
    actionedBlockIds: stable?.actionedBlockIds ?? toIdSet(actionedBlockIds),
    dismissedPinnedIds,
    onToast: showWorkbenchToast,
    selectedExecutionTargetId,
    onExecutionTargetChange: setSelectedExecutionTargetId,
    mentionableAgents,
    showComposerAgentPicker,
    showComposerStatus,
    composerTargetLabel: activeConversation?.title ?? 'AgentHub',
    currentConversationId,
    platform,
    composer,
    dispatchComposer,
    composerInputRef,
    searchOpen,
    onSearchOpenChange: setSearchOpen,
  };

  assignIfDefined(hostProps, 'activeConversation', activeConversation);
  assignIfDefined(hostProps, 'connectionStatus', connectionStatus);
  assignIfDefined(hostProps, 'workbenchStatus', workbenchStatus);
  assignIfDefined(hostProps, 'transcriptUnreadDivider', transcriptUnreadDivider);
  assignIfDefined(hostProps, 'highlightedBlockId', highlightedBlockId);
  assignIfDefined(hostProps, 'onHighlightEnd', onHighlightEnd);
  assignIfDefined(hostProps, 'composerExecutionTargets', composerExecutionTargets);
  assignIfDefined(hostProps, 'isAgentRunning', props.isAgentRunning);
  assignIfDefined(hostProps, 'onCancelRun', props.onCancelRun);
  assignIfDefined(hostProps, 'onEditMessage', props.onEditMessage);
  assignIfDefined(hostProps, 'transcriptLoading', transcriptLoading);

  return hostProps;
}

/**
 * Hook form of buildChatConversationHostProps, used by ChatConversationHostFrame.
 *
 * Memoizes the five per-render derived host props so the ConversationHost /
 * ChatViewBridge memo gates hold across shell re-renders (every keystroke,
 * toasts, sidebar changes, ...). Deps are exactly the underlying values each
 * derived prop closes over:
 *  - onBlockContextMenu closes over `transcript` + `openBlockContextMenu`
 *    (controller-bound, referentially stable);
 *  - onBlockSelect closes over `handleBlockSelect` (controller-bound, stable);
 *  - the three id Sets are pure projections of their source arrays (state
 *    arrays — identity changes only when the selection actually changes).
 */
export function useBuildChatConversationHostProps(
  props: ChatConversationHostFrameProps,
): ConversationHostProps {
  const { transcript, transcriptChrome } = props;
  const {
    selectedBlockIds,
    softHiddenBlockIds,
    actionedBlockIds,
    openBlockContextMenu,
    handleBlockSelect,
  } = transcriptChrome;

  const onBlockContextMenu = useMemo(
    () => createTranscriptBlockContextMenuHandler(transcript, openBlockContextMenu),
    [transcript, openBlockContextMenu],
  );
  const onBlockSelect = useMemo(
    () => createTranscriptBlockSelectHandler(handleBlockSelect),
    [handleBlockSelect],
  );
  const selectedBlockIdSet = useMemo(() => toIdSet(selectedBlockIds), [selectedBlockIds]);
  const softHiddenBlockIdSet = useMemo(() => toIdSet(softHiddenBlockIds), [softHiddenBlockIds]);
  const actionedBlockIdSet = useMemo(() => toIdSet(actionedBlockIds), [actionedBlockIds]);

  return buildChatConversationHostProps(props, {
    onBlockContextMenu,
    onBlockSelect,
    selectedBlockIds: selectedBlockIdSet,
    softHiddenBlockIds: softHiddenBlockIdSet,
    actionedBlockIds: actionedBlockIdSet,
  });
}

export function buildWorkbenchRoutesProps(
  props: WorkbenchRoutesFrameProps,
): WorkbenchRoutesProps {
  const routesProps: WorkbenchRoutesProps = {
    activePage: props.activePage,
    localCliDiscovery: props.localCliDiscovery,
    sessionImportItems: props.sessionImportItems,
    sessionImportLoading: props.sessionImportLoading,
    sessionImportError: props.sessionImportError,
    sessionImportVisible: props.sessionImportVisible,
    onRefreshSessionImport: props.onRefreshSessionImport,
    settingsService: props.settingsService,
    onAgentProfileOpen: props.onAgentProfileOpen,
    onNavigatePage: props.onNavigatePage,
  };

  assignIfDefined(routesProps, 'agents', props.agents);
  assignIfDefined(routesProps, 'agentProfilesStatus', props.agentProfilesStatus);
  assignIfDefined(routesProps, 'dataMode', props.dataMode);
  assignIfDefined(routesProps, 'contacts', props.contacts);
  assignIfDefined(routesProps, 'documents', props.documents);
  assignIfDefined(routesProps, 'focusedAgentId', props.focusedAgentId);
  assignIfDefined(routesProps, 'projects', props.projects);
  assignIfDefined(routesProps, 'activeProjectId', props.activeProjectId);
  assignIfDefined(routesProps, 'projectsStatus', props.projectsStatus);
  assignIfDefined(routesProps, 'onActiveProjectChange', props.onActiveProjectChange);
  assignIfDefined(routesProps, 'onProjectCreate', props.onProjectCreate);
  assignIfDefined(routesProps, 'onProjectUpdate', props.onProjectUpdate);
  assignIfDefined(routesProps, 'projectsPort', props.projectsPort);
  assignIfDefined(routesProps, 'onAgentCreate', props.onAgentCreate);
  assignIfDefined(routesProps, 'onAgentUpdate', props.onAgentUpdate);
  assignIfDefined(routesProps, 'onAgentDelete', props.onAgentDelete);
  assignIfDefined(routesProps, 'onAgentsRetry', props.onAgentsRetry);
  assignIfDefined(routesProps, 'onStartConversation', props.onStartConversation);
  assignIfDefined(routesProps, 'contactsActions', props.contactsActions);
  assignIfDefined(routesProps, 'documentsActions', props.documentsActions);
  assignIfDefined(routesProps, 'modelCatalog', props.modelCatalog);
  assignIfDefined(routesProps, 'ccSwitchStatus', props.ccSwitchStatus);
  assignIfDefined(routesProps, 'ccSwitchProviders', props.ccSwitchProviders);
  assignIfDefined(routesProps, 'skillMarketItems', props.skillMarketItems);
  assignIfDefined(routesProps, 'skillMarketLoading', props.skillMarketLoading);
  assignIfDefined(routesProps, 'skillMarketError', props.skillMarketError);
  assignIfDefined(routesProps, 'mcpMarketItems', props.mcpMarketItems);
  assignIfDefined(routesProps, 'mcpMarketLoading', props.mcpMarketLoading);
  assignIfDefined(routesProps, 'mcpMarketError', props.mcpMarketError);
  assignIfDefined(routesProps, 'currentUserId', props.currentUserId);
  assignIfDefined(routesProps, 'userDisplayName', props.userDisplayName);
  assignIfDefined(routesProps, 'devicesTargets', props.devicesTargets);
  assignIfDefined(routesProps, 'devicesLoading', props.devicesLoading);
  assignIfDefined(routesProps, 'devicesError', props.devicesError);
  assignIfDefined(routesProps, 'onDevicesRetry', props.onDevicesRetry);
  assignIfDefined(routesProps, 'devicesPingingId', props.devicesPingingId);
  assignIfDefined(routesProps, 'onDevicePing', props.onDevicePing);
  assignIfDefined(routesProps, 'usageTeams', props.usageTeams);
  assignIfDefined(routesProps, 'usageLoading', props.usageLoading);
  assignIfDefined(routesProps, 'usageError', props.usageError);
  assignIfDefined(routesProps, 'onUsageRetry', props.onUsageRetry);

  return routesProps;
}

export function buildChatInspectorProps(
  props: ChatInspectorFrameProps,
): RightInspectorProps {
  const {
    platform,
    session,
    runtimeEvidence,
    inspectorCollapsed,
    inspectorWidth,
    resizeInspectorBy,
    beginInspectorResize,
  } = props;
  const {
    reviewFileRequest,
    evidence,
    inspectorRouteBlocks,
    inspectorContextBlocks,
    inspectorDeployPreviewUrl,
    inspectorBrowserFocusRequest,
    inspectorRunResult,
    composer,
  } = session;

  const inspectorProps: RightInspectorProps = {
    browserPreviewEnabled: platform.capabilities.browserPreview,
    collapsed: inspectorCollapsed,
    defaultBrowserUrl: DEFAULT_BROWSER_PREVIEW_URL,
    evidence,
    maxWidth: INSPECTOR_MAX_WIDTH,
    minWidth: INSPECTOR_MIN_WIDTH,
    onResizeBy: resizeInspectorBy,
    onResizeStart: beginInspectorResize,
    width: inspectorWidth,
  };

  assignIfDefined(inspectorProps, 'canOpenPreview', platform.preview?.canOpenEvidence);
  assignIfDefined(inspectorProps, 'onOpenPreview', platform.preview?.openEvidence);
  assignIfDefined(inspectorProps, 'previewPort', platform.preview);
  assignIfDefined(inspectorProps, 'reviewFileRequest', reviewFileRequest);
  assignIfDefined(inspectorProps, 'runtimeEvidence', runtimeEvidence);
  assignIfDefined(inspectorProps, 'workDir', resolveComposerWorkDir(composer.workDir));
  assignIfDefined(inspectorProps, 'contextBlocks', inspectorContextBlocks);
  assignIfDefined(inspectorProps, 'routeBlocks', inspectorRouteBlocks);
  assignIfDefined(inspectorProps, 'deployPreviewUrl', inspectorDeployPreviewUrl);
  assignIfDefined(inspectorProps, 'browserFocusRequest', inspectorBrowserFocusRequest);
  assignIfDefined(inspectorProps, 'runResult', inspectorRunResult);

  return inspectorProps;
}
