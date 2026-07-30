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
   frames. No React hooks / no intentional UX change.
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
  return sidebarProps;
}

export function buildChatConversationHostProps(
  props: ChatConversationHostFrameProps,
): ConversationHostProps {
  const {
    platform,
    session,
    transcriptChrome,
    profile,
    transcript,
    connectionStatus,
    inspectorCollapsed,
    toggleInspector,
    showMainchainStatus,
    workbenchStatus,
    composerExecutionTargets,
    showComposerAgentPicker,
    showComposerStatus,
    highlightedBlockId,
    onHighlightEnd,
  } = props;
  const {
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
    mainchainSummary,
    mentionableAgents,
    openReviewFile,
    handleDeploySubmit,
    exportMainchainEvidence,
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
    showMainchainStatus,
    mainchainSummary,
    onExportMainchainEvidence: exportMainchainEvidence,
    onAgentClick: openAgentProfile,
    onBlockContextMenu: createTranscriptBlockContextMenuHandler(
      transcript,
      openBlockContextMenu,
    ),
    onBlockSelect: createTranscriptBlockSelectHandler(handleBlockSelect),
    onBlockAction: handleTranscriptBlockAction,
    onReviewFile: openReviewFile,
    onDeploySubmit: handleDeploySubmit,
    selectedBlockIds: toIdSet(selectedBlockIds),
    selectionMode,
    softHiddenBlockIds: toIdSet(softHiddenBlockIds),
    actionedBlockIds: toIdSet(actionedBlockIds),
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
  assignIfDefined(hostProps, 'highlightedBlockId', highlightedBlockId);
  assignIfDefined(hostProps, 'onHighlightEnd', onHighlightEnd);
  assignIfDefined(hostProps, 'composerExecutionTargets', composerExecutionTargets);
  assignIfDefined(hostProps, 'isAgentRunning', props.isAgentRunning);
  assignIfDefined(hostProps, 'onCancelRun', props.onCancelRun);
  assignIfDefined(hostProps, 'onEditMessage', props.onEditMessage);

  return hostProps;
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
  assignIfDefined(routesProps, 'hubClient', props.hubClient);
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
  assignIfDefined(routesProps, 'mcpMarketItems', props.mcpMarketItems);
  assignIfDefined(routesProps, 'mcpMarketLoading', props.mcpMarketLoading);
  assignIfDefined(routesProps, 'currentUserId', props.currentUserId);
  assignIfDefined(routesProps, 'userDisplayName', props.userDisplayName);

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
  assignIfDefined(inspectorProps, 'reviewFileRequest', reviewFileRequest);
  assignIfDefined(inspectorProps, 'runtimeEvidence', runtimeEvidence);
  assignIfDefined(inspectorProps, 'workDir', resolveComposerWorkDir(composer.workDir));
  assignIfDefined(inspectorProps, 'contextBlocks', inspectorContextBlocks);
  assignIfDefined(inspectorProps, 'routeBlocks', inspectorRouteBlocks);
  assignIfDefined(inspectorProps, 'deployPreviewUrl', inspectorDeployPreviewUrl);
  assignIfDefined(inspectorProps, 'runResult', inspectorRunResult);

  return inspectorProps;
}
