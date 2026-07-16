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
import { GlobalRail, type ConnectionStatusKind, type GlobalRailPage } from './GlobalRail';
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
import type { WorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import type { WorkbenchSessionChrome } from './useWorkbenchSessionChrome';
import type { WorkbenchTranscriptChrome } from './useWorkbenchTranscriptChrome';
import type { WorkbenchProfileChrome } from './useWorkbenchProfileChrome';
import type { TranscriptContextMenuEvent } from './transcriptEventTypes';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './workbenchLayoutConstants';
import styles from './AgentHubWorkbench.module.css';

const DEFAULT_BROWSER_PREVIEW_URL = '/demo-preview.html';

export interface WorkbenchFrameProps {
  platform: AgentHubPlatform;
  activePage: GlobalRailPage;
  isChatPage: boolean;
  layout: WorkbenchPanelLayout;
  session: WorkbenchSessionChrome;
  transcriptChrome: WorkbenchTranscriptChrome;
  profile: WorkbenchProfileChrome;

  conversations: WorkbenchConversation[];
  agents?: WorkbenchAgent[] | undefined;
  composerExecutionTargets?: Array<{ id: string; label: string }> | undefined;
  workbenchStatus?: {
    dataMode?: string;
    replayLabel?: string;
    targetLabel?: string;
    targetState?: string;
    initialLoading?: boolean;
    loadError?: string;
  } | undefined;
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  contacts?: WorkbenchContactsData | undefined;
  projects?: ProjectInfo[] | undefined;
  activeProjectId?: string | undefined;
  projectsStatus?: {
    loading?: boolean | undefined;
    error?: string | undefined;
    actionError?: string | undefined;
    saving?: boolean | undefined;
  } | undefined;
  onConversationPin?: ((conversationId: string, pinned: boolean) => void) | undefined;
  onConversationArchive?: ((conversationId: string, archived: boolean) => void) | undefined;
  onActiveProjectChange?: ((projectId: string) => void) | undefined;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
  onAgentsRetry?: (() => void) | undefined;
  onLogout?: (() => void) | undefined;
  onProjectCreate?: ((draft: ProjectDraft) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  onProjectUpdate?: ((
    projectId: string,
    draft: ProjectDraft,
  ) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  hubClient?: HubClient | undefined;
  onNavigateToConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
  contactsActions?: WorkbenchContactsActions | undefined;
  documents?: DocRow[] | undefined;
  documentsActions?: WorkbenchDocumentsActions | undefined;
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
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  showComposerAgentPicker: boolean;
  showComposerStatus: boolean;
  showMainchainStatus: boolean;
  transcript: TranscriptBlock[];
  userDisplayName?: string | undefined;
  userAvatarUrl?: string | undefined;
  currentUserId?: string | undefined;
  skillMarketItems?: SkillMarketItem[] | undefined;
  skillMarketLoading?: boolean | undefined;
  mcpMarketItems?: MCPMarketItem[] | undefined;
  mcpMarketLoading?: boolean | undefined;
  highlightedBlockId?: string | undefined;
  onHighlightEnd?: (() => void) | undefined;
  connectionStatus?: ConnectionStatusKind | undefined;
  setActivePage: (page: GlobalRailPage) => void;
  children?: React.ReactNode;
}

/**
 * Presentational workbench frame: shell attrs, GlobalRail, chat sidebar + resizer,
 * main workspace host (loading / ConversationHost / WorkbenchRoutes), and RightInspector.
 * No local state or resize math — consumes already-resolved hook outputs only.
 */
export function WorkbenchFrame({
  platform,
  activePage,
  isChatPage,
  layout,
  session,
  transcriptChrome,
  profile,
  conversations,
  agents,
  composerExecutionTargets,
  workbenchStatus,
  agentProfilesStatus,
  contacts,
  projects,
  activeProjectId,
  projectsStatus,
  onConversationPin,
  onConversationArchive,
  onActiveProjectChange,
  onAgentCreate,
  onAgentUpdate,
  onAgentDelete,
  onAgentsRetry,
  onLogout,
  onProjectCreate,
  onProjectUpdate,
  hubClient,
  onNavigateToConversation,
  contactsActions,
  documents,
  documentsActions,
  modelCatalog,
  ccSwitchStatus,
  ccSwitchProviders,
  runtimeEvidence,
  showComposerAgentPicker,
  showComposerStatus,
  showMainchainStatus,
  transcript,
  userDisplayName,
  userAvatarUrl,
  currentUserId,
  skillMarketItems,
  skillMarketLoading,
  mcpMarketItems,
  mcpMarketLoading,
  highlightedBlockId,
  onHighlightEnd,
  connectionStatus,
  setActivePage,
  children,
}: WorkbenchFrameProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const {
    inspectorWidth,
    inspectorCollapsed,
    inspectorResizing,
    sidebarWidth,
    sidebarCollapsed,
    sidebarResizing,
    toggleInspector,
    navigateRail,
    beginInspectorResize,
    beginSidebarResize,
    resizeInspectorBy,
    resizeSidebarBy,
    shellStyle,
  } = layout;
  const {
    settingsService,
    currentConversationId,
    selectConversation,
    activeConversation,
    selectedExecutionTargetId,
    setSelectedExecutionTargetId,
    dismissedPinnedIds,
    localCliDiscovery,
    reviewFileRequest,
    searchOpen,
    setSearchOpen,
    workspaceRef,
    composerInputRef,
    composer,
    dispatchComposer,
    evidence,
    mainchainSummary,
    inspectorRouteBlocks,
    inspectorContextBlocks,
    inspectorDeployPreviewUrl,
    inspectorRunResult,
    mentionableAgents,
    handleToggleTheme,
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
  const {
    focusedAgentId,
    openAgentProfile,
    openAgentProfileFromConfig,
    openConversationAvatar,
  } = profile;

  return (
    <div
      className={styles.shell}
      data-inspector-collapsed={inspectorCollapsed ? 'true' : 'false'}
      data-inspector-resizing={inspectorResizing ? 'true' : 'false'}
      data-page={activePage}
      data-selection-mode={selectionMode ? 'true' : 'false'}
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
      data-sidebar-resizing={sidebarResizing ? 'true' : 'false'}
      data-data-mode={workbenchStatus?.dataMode}
      data-testid="agenthub-workbench"
      style={shellStyle}
    >
      <GlobalRail
        activePage={activePage}
        onNavigate={navigateRail}
        onLogout={onLogout}
        onToggleTheme={handleToggleTheme}
        userDisplayName={userDisplayName}
        userAvatarUrl={userAvatarUrl}
      />
      {isChatPage && (
        <div className={styles.sidebarFrame}>
          <ConversationSidebar
            activeConversationId={currentConversationId}
            conversations={conversations}
            onAvatarClick={openConversationAvatar}
            onSelectConversation={selectConversation}
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
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const step = event.shiftKey ? 40 : 16;
              resizeSidebarBy(event.key === 'ArrowLeft' ? -step : step);
            }}
            onPointerDown={(event) => {
              if (sidebarCollapsed) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              beginSidebarResize(event.clientX);
            }}
            role="separator"
            tabIndex={sidebarCollapsed ? -1 : 0}
          />
        </div>
      )}

      <main
        ref={workspaceRef as React.RefObject<HTMLElement>}
        aria-label={t('aria.workspace')}
        className={styles.workspace}
        data-mainchain={showMainchainStatus ? 'true' : 'false'}
        data-mode={isChatPage ? 'chat' : 'workbench'}
        data-surface={platform.surface}
        data-workspace-main
      >
        {workbenchStatus?.initialLoading && conversations.length === 0 ? (
          <div className={styles.workspaceLoading} role="status">
            <span className={styles.workspaceLoadingSpinner} />
            <span className={styles.workspaceLoadingLabel}>{t('connection.connecting')}</span>
          </div>
        ) : isChatPage ? (
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
            onBlockContextMenu={(blockId, event) => {
              const block = transcript.find((b) => b.id === blockId);
              if (block) openBlockContextMenu(block, event as unknown as TranscriptContextMenuEvent);
            }}
            onBlockSelect={(blockId, shiftKey) => handleBlockSelect(blockId, { shiftKey: shiftKey ?? false })}
            onBlockAction={handleTranscriptBlockAction}
            onReviewFile={openReviewFile}
            onDeploySubmit={handleDeploySubmit}
            selectedBlockIds={new Set(selectedBlockIds)}
            selectionMode={selectionMode}
            softHiddenBlockIds={new Set(softHiddenBlockIds)}
            actionedBlockIds={new Set(actionedBlockIds)}
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
        ) : (
          <section aria-label={t('aria.workbenchPage')} className={styles.workbenchPageHost}>
            <WorkbenchRoutes
              activePage={activePage as Exclude<GlobalRailPage, 'chat'>}
              agents={agents}
              agentProfilesStatus={agentProfilesStatus}
              dataMode={workbenchStatus?.dataMode}
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
              onAgentProfileOpen={openAgentProfileFromConfig}
              onStartConversation={onNavigateToConversation}
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
              onNavigatePage={setActivePage}
              currentUserId={currentUserId}
              userDisplayName={userDisplayName}
            />
          </section>
        )}
      </main>

      {isChatPage && (
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
          workDir={composer.workDir?.trim() || undefined}
          onResizeBy={resizeInspectorBy}
          onResizeStart={beginInspectorResize}
          width={inspectorWidth}
        />
      )}
      {children}
    </div>
  );
}
