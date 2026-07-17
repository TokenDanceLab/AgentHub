import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AgentHubPlatform,
  WorkbenchAgent,
  WorkbenchConversation,
} from '../platform';
import type { TranscriptBlock } from '../transcript';
import { ConversationHost } from './ConversationHost';
import { ConversationSidebar } from './ConversationSidebar';
import type { ConnectionStatusKind, GlobalRailPage } from './GlobalRail';
import { RightInspector, type RuntimeEvidenceSnapshot } from './RightInspector';
import {
  WorkbenchRoutes,
  type WorkbenchAgentProfilesStatus,
  type WorkbenchContactsActions,
  type WorkbenchContactsData,
  type WorkbenchDocumentsActions,
} from './WorkbenchRoutes';
import type { HubClient } from '../hubClient';
import type { AgentConfig, DocRow, ProjectDraft } from './pages';
import type { MCPMarketItem, SkillMarketItem } from './pages/AgentsPage';
import type { ProjectInfo } from './pages/ProjectsPage';
import type { WorkbenchSessionChrome } from './useWorkbenchSessionChrome';
import type { WorkbenchTranscriptChrome } from './useWorkbenchTranscriptChrome';
import type { WorkbenchProfileChrome } from './useWorkbenchProfileChrome';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './workbenchLayoutConstants';
import {
  DEFAULT_BROWSER_PREVIEW_URL,
  createTranscriptBlockContextMenuHandler,
  createTranscriptBlockSelectHandler,
  createVerticalResizerKeyDownHandler,
  createVerticalResizerPointerDownHandler,
  resolveComposerWorkDir,
  toIdSet,
} from './workbenchFrameHelpers';
import styles from './AgentHubWorkbench.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   WorkbenchFrameParts — presentational residual slices from WorkbenchFrame
   (#637). CSS stays on AgentHubWorkbench.module.css. No intentional UX
   change.
   ═══════════════════════════════════════════════════════════════════════ */

export interface ChatSidebarFrameProps {
  conversations: WorkbenchConversation[];
  currentConversationId: string;
  onSelectConversation: (conversationId: string) => void;
  onAvatarClick: (conversation: WorkbenchConversation, anchor: HTMLElement) => void;
  onConversationPin?: ((conversationId: string, pinned: boolean) => void) | undefined;
  onConversationArchive?: ((conversationId: string, archived: boolean) => void) | undefined;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  resizeSidebarBy: (delta: number) => void;
  beginSidebarResize: (clientX: number) => void;
}

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
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const onKeyDown = createVerticalResizerKeyDownHandler(resizeSidebarBy);
  const onPointerDown = createVerticalResizerPointerDownHandler(
    sidebarCollapsed,
    beginSidebarResize,
  );

  return (
    <div className={styles.sidebarFrame}>
      <ConversationSidebar
        activeConversationId={currentConversationId}
        conversations={conversations}
        onAvatarClick={onAvatarClick}
        onSelectConversation={onSelectConversation}
        onPinConversation={onConversationPin}
        onArchiveConversation={onConversationArchive}
      />
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
    </div>
  );
}

export interface WorkspaceLoadingStateProps {
  label: string;
}

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

export interface ChatConversationHostFrameProps {
  platform: AgentHubPlatform;
  session: WorkbenchSessionChrome;
  transcriptChrome: WorkbenchTranscriptChrome;
  profile: WorkbenchProfileChrome;
  transcript: TranscriptBlock[];
  connectionStatus?: ConnectionStatusKind | undefined;
  inspectorCollapsed: boolean;
  toggleInspector: () => void;
  showMainchainStatus: boolean;
  workbenchStatus?: {
    dataMode?: string;
    replayLabel?: string;
    targetLabel?: string;
    targetState?: string;
    initialLoading?: boolean;
    loadError?: string;
  } | undefined;
  composerExecutionTargets?: Array<{ id: string; label: string }> | undefined;
  showComposerAgentPicker: boolean;
  showComposerStatus: boolean;
  highlightedBlockId?: string | undefined;
  onHighlightEnd?: (() => void) | undefined;
}

/** ConversationHost wiring for chat page — pure prop mapping. */
export function ChatConversationHostFrame({
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
}: ChatConversationHostFrameProps): React.ReactElement {
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

  return (
    <ConversationHost
      transcript={transcript}
      activeConversation={activeConversation}
      connectionStatus={connectionStatus}
      inspectorCollapsed={inspectorCollapsed}
      onToggleInspector={toggleInspector}
      showMainchainStatus={showMainchainStatus}
      mainchainSummary={mainchainSummary}
      onExportMainchainEvidence={exportMainchainEvidence}
      workbenchStatus={workbenchStatus}
      onAgentClick={openAgentProfile}
      onBlockContextMenu={createTranscriptBlockContextMenuHandler(
        transcript,
        openBlockContextMenu,
      )}
      onBlockSelect={createTranscriptBlockSelectHandler(handleBlockSelect)}
      onBlockAction={handleTranscriptBlockAction}
      onReviewFile={openReviewFile}
      onDeploySubmit={handleDeploySubmit}
      selectedBlockIds={toIdSet(selectedBlockIds)}
      selectionMode={selectionMode}
      softHiddenBlockIds={toIdSet(softHiddenBlockIds)}
      actionedBlockIds={toIdSet(actionedBlockIds)}
      highlightedBlockId={highlightedBlockId}
      onHighlightEnd={onHighlightEnd}
      dismissedPinnedIds={dismissedPinnedIds}
      onToast={showWorkbenchToast}
      composerExecutionTargets={composerExecutionTargets}
      selectedExecutionTargetId={selectedExecutionTargetId}
      onExecutionTargetChange={setSelectedExecutionTargetId}
      mentionableAgents={mentionableAgents}
      showComposerAgentPicker={showComposerAgentPicker}
      showComposerStatus={showComposerStatus}
      composerTargetLabel={activeConversation?.title ?? 'AgentHub'}
      currentConversationId={currentConversationId}
      platform={platform}
      composer={composer}
      dispatchComposer={dispatchComposer}
      composerInputRef={composerInputRef}
      searchOpen={searchOpen}
      onSearchOpenChange={setSearchOpen}
    />
  );
}

export interface WorkbenchRoutesFrameProps {
  activePage: Exclude<GlobalRailPage, 'chat'>;
  agents?: WorkbenchAgent[] | undefined;
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  dataMode?: string | undefined;
  contacts?: WorkbenchContactsData | undefined;
  documents?: DocRow[] | undefined;
  focusedAgentId?: string | undefined;
  projects?: ProjectInfo[] | undefined;
  activeProjectId?: string | undefined;
  projectsStatus?: {
    loading?: boolean | undefined;
    error?: string | undefined;
    actionError?: string | undefined;
    saving?: boolean | undefined;
  } | undefined;
  onActiveProjectChange?: ((projectId: string) => void) | undefined;
  onProjectCreate?: ((draft: ProjectDraft) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  onProjectUpdate?: ((
    projectId: string,
    draft: ProjectDraft,
  ) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  hubClient?: HubClient | undefined;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
  onAgentsRetry?: (() => void) | undefined;
  onAgentProfileOpen: WorkbenchProfileChrome['openAgentProfileFromConfig'];
  onStartConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
  contactsActions?: WorkbenchContactsActions | undefined;
  documentsActions?: WorkbenchDocumentsActions | undefined;
  localCliDiscovery: WorkbenchSessionChrome['localCliDiscovery'];
  modelCatalog?: Array<{
    id: string;
    label: string;
    value: string;
    provider?: string;
    status: string;
    description?: string;
    default?: boolean;
    tags?: string[];
  }> | undefined;
  ccSwitchStatus?: import('./pages/AgentsPage').CCSwitchStatusInfo | undefined;
  ccSwitchProviders?: import('./pages/AgentsPage').CCSwitchProviderInfo[] | undefined;
  settingsService: WorkbenchSessionChrome['settingsService'];
  skillMarketItems?: SkillMarketItem[] | undefined;
  skillMarketLoading?: boolean | undefined;
  mcpMarketItems?: MCPMarketItem[] | undefined;
  mcpMarketLoading?: boolean | undefined;
  onNavigatePage: (page: GlobalRailPage) => void;
  currentUserId?: string | undefined;
  userDisplayName?: string | undefined;
}

/** Non-chat page host wrapping WorkbenchRoutes. */
export function WorkbenchRoutesFrame({
  activePage,
  agents,
  agentProfilesStatus,
  dataMode,
  contacts,
  documents,
  focusedAgentId,
  projects,
  activeProjectId,
  projectsStatus,
  onActiveProjectChange,
  onProjectCreate,
  onProjectUpdate,
  hubClient,
  onAgentCreate,
  onAgentUpdate,
  onAgentDelete,
  onAgentsRetry,
  onAgentProfileOpen,
  onStartConversation,
  contactsActions,
  documentsActions,
  localCliDiscovery,
  modelCatalog,
  ccSwitchStatus,
  ccSwitchProviders,
  settingsService,
  skillMarketItems,
  skillMarketLoading,
  mcpMarketItems,
  mcpMarketLoading,
  onNavigatePage,
  currentUserId,
  userDisplayName,
}: WorkbenchRoutesFrameProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);

  return (
    <section aria-label={t('aria.workbenchPage')} className={styles.workbenchPageHost}>
      <WorkbenchRoutes
        activePage={activePage}
        agents={agents}
        agentProfilesStatus={agentProfilesStatus}
        dataMode={dataMode}
        contacts={contacts}
        documents={documents}
        focusedAgentId={focusedAgentId}
        projects={projects}
        activeProjectId={activeProjectId}
        projectsStatus={projectsStatus}
        onActiveProjectChange={onActiveProjectChange}
        onProjectCreate={onProjectCreate}
        onProjectUpdate={onProjectUpdate}
        hubClient={hubClient}
        onAgentCreate={onAgentCreate}
        onAgentUpdate={onAgentUpdate}
        onAgentDelete={onAgentDelete}
        onAgentsRetry={onAgentsRetry}
        onAgentProfileOpen={onAgentProfileOpen}
        onStartConversation={onStartConversation}
        contactsActions={contactsActions}
        documentsActions={documentsActions}
        localCliDiscovery={localCliDiscovery}
        modelCatalog={modelCatalog}
        ccSwitchStatus={ccSwitchStatus}
        ccSwitchProviders={ccSwitchProviders}
        settingsService={settingsService}
        skillMarketItems={skillMarketItems}
        skillMarketLoading={skillMarketLoading}
        mcpMarketItems={mcpMarketItems}
        mcpMarketLoading={mcpMarketLoading}
        onNavigatePage={onNavigatePage}
        currentUserId={currentUserId}
        userDisplayName={userDisplayName}
      />
    </section>
  );
}

export interface ChatInspectorFrameProps {
  platform: AgentHubPlatform;
  session: WorkbenchSessionChrome;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  inspectorCollapsed: boolean;
  inspectorWidth: number;
  resizeInspectorBy: (delta: number) => void;
  beginInspectorResize: (clientX: number) => void;
}

/** RightInspector host for chat page. */
export function ChatInspectorFrame({
  platform,
  session,
  runtimeEvidence,
  inspectorCollapsed,
  inspectorWidth,
  resizeInspectorBy,
  beginInspectorResize,
}: ChatInspectorFrameProps): React.ReactElement {
  const {
    reviewFileRequest,
    evidence,
    inspectorRouteBlocks,
    inspectorContextBlocks,
    inspectorDeployPreviewUrl,
    inspectorRunResult,
    composer,
  } = session;

  return (
    <RightInspector
      browserPreviewEnabled={platform.capabilities.browserPreview}
      canOpenPreview={platform.preview?.canOpenEvidence}
      collapsed={inspectorCollapsed}
      contextBlocks={inspectorContextBlocks}
      defaultBrowserUrl={DEFAULT_BROWSER_PREVIEW_URL}
      deployPreviewUrl={inspectorDeployPreviewUrl}
      evidence={evidence}
      maxWidth={INSPECTOR_MAX_WIDTH}
      minWidth={INSPECTOR_MIN_WIDTH}
      onOpenPreview={platform.preview?.openEvidence}
      reviewFileRequest={reviewFileRequest}
      routeBlocks={inspectorRouteBlocks}
      runtimeEvidence={runtimeEvidence}
      runResult={inspectorRunResult}
      workDir={resolveComposerWorkDir(composer.workDir)}
      onResizeBy={resizeInspectorBy}
      onResizeStart={beginInspectorResize}
      width={inspectorWidth}
    />
  );
}
