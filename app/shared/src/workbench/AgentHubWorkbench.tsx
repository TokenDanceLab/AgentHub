import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AgentHubPlatform,
  WorkbenchAgent,
  WorkbenchConversation,
} from '../platform';
import type { TranscriptBlock, ApprovalDecisionAction } from '../transcript';
import { ConversationHost } from './ConversationHost';
import { ConversationSidebar } from './ConversationSidebar';
import { GlobalRail, type GlobalRailPage, type ConnectionStatusKind } from './GlobalRail';
import { RightInspector, type RuntimeEvidenceSnapshot } from './RightInspector';
import { type TranscriptContextMenuEvent } from './transcriptEventTypes';
import { WorkbenchRoutes } from './WorkbenchRoutes';
import type { WorkbenchAgentProfilesStatus, WorkbenchContactsData, WorkbenchContactsActions, WorkbenchDocumentsActions } from './WorkbenchRoutes';
import type { HubClient } from '../hubClient';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';

import type { AgentConfig, ProjectDraft, DocRow } from './pages';
import type { SkillMarketItem, MCPMarketItem } from './pages/AgentsPage';
import type { ProjectInfo } from './pages/ProjectsPage';
import { useWorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import { useWorkbenchProfileChrome } from './useWorkbenchProfileChrome';
import { useWorkbenchSessionChrome } from './useWorkbenchSessionChrome';
import { useWorkbenchTranscriptChrome } from './useWorkbenchTranscriptChrome';
import { WorkbenchProfileOverlays } from './WorkbenchProfileOverlays';
import { WorkbenchTranscriptOverlays } from './WorkbenchTranscriptOverlays';
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './workbenchLayoutConstants';
import styles from './AgentHubWorkbench.module.css';

const DEFAULT_BROWSER_PREVIEW_URL = '/demo-preview.html';

export interface AgentHubWorkbenchProps {
  platform: AgentHubPlatform;
  conversations: WorkbenchConversation[];
  agents?: WorkbenchAgent[];
  composerExecutionTargets?: Array<{ id: string; label: string }> | undefined;
  workbenchStatus?: {
    dataMode?: string;
    replayLabel?: string;
    targetLabel?: string;
    targetState?: string;
    /** Whether the workbench is loading initial data (threads/conversations not yet loaded). */
    initialLoading?: boolean;
    /** Error message from initial data load, if any. */
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
  activeConversationId?: string;
  onActiveConversationChange?: ((conversationId: string) => void) | undefined;
  /** Called when the user toggles pin on a session. Parent should call Hub API and refresh. */
  onConversationPin?: ((conversationId: string, pinned: boolean) => void) | undefined;
  /** Called when the user toggles archive on a session. Parent should call Hub API and refresh. */
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
  /** Hub client for direct project API access when onProjectCreate/Update are not provided. */
  hubClient?: HubClient | undefined;
  onApprovalDecision?: ((action: ApprovalDecisionAction) => Promise<void> | void) | undefined;
  /** 用户想与某个联系人/Agent 开始私聊，但当前没有已有会话时触发。上层负责创建会话并切换。 */
  onNavigateToConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
  /** Contact mutation actions passed through to ContactsPage. */
  contactsActions?: WorkbenchContactsActions | undefined;
  /** Document rows for DocsPage (real data first, mock fallback). */
  documents?: DocRow[] | undefined;
  /** Document mutation actions wired to Hub Documents API. */
  documentsActions?: WorkbenchDocumentsActions | undefined;
  /** Model catalog items from Edge API. When provided, the Agents page
   *  Models tab shows real model data instead of mock fixtures. */
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
  /** cc-switch transparent proxy status from Edge API. */
  ccSwitchStatus?: import('./pages/AgentsPage').CCSwitchStatusInfo | undefined;
  /** cc-switch provider model alias mappings. */
  ccSwitchProviders?: import('./pages/AgentsPage').CCSwitchProviderInfo[] | undefined;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  showComposerAgentPicker?: boolean | undefined;
  showComposerStatus?: boolean | undefined;
  showMainchainStatus?: boolean | undefined;
  transcript: TranscriptBlock[];
  /** Current user profile info, shown in GlobalRail avatar and profile popover. */
  userDisplayName?: string | undefined;
  userAvatarUrl?: string | undefined;
  /** Current user's Hub ID, used to distinguish "my" messages/tasks from others. */
  currentUserId?: string | undefined;
  /** Public Skill market items from Hub API. */
  skillMarketItems?: SkillMarketItem[] | undefined;
  /** Whether Skill market data is loading. */
  skillMarketLoading?: boolean | undefined;
  /** Public MCP Server market items from Hub API. */
  mcpMarketItems?: MCPMarketItem[] | undefined;
  /** Whether MCP Server market data is loading. */
  mcpMarketLoading?: boolean | undefined;
  /** Block ID to highlight (e.g. from a search result click). Cleared after 3 s animation. */
  highlightedBlockId?: string | undefined;
  /** Called when the highlight animation ends. */
  onHighlightEnd?: (() => void) | undefined;
  /** Called when the user requests regeneration of an agent message. Receives the block ID. */
  onRegenerate?: ((blockId: string) => void) | undefined;
  /** WebSocket connection status for the rail indicator dot. */
  connectionStatus?: ConnectionStatusKind | undefined;
}

export function AgentHubWorkbench({
  platform,
  conversations,
  agents,
  composerExecutionTargets,
  workbenchStatus,
  agentProfilesStatus,
  contacts,
  projects,
  activeProjectId,
  projectsStatus,
  activeConversationId,
  onActiveConversationChange,
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
  onApprovalDecision,
  onNavigateToConversation,
  contactsActions,
  documents,
  documentsActions,
  modelCatalog,
  ccSwitchStatus,
  ccSwitchProviders,
  runtimeEvidence,
  showComposerAgentPicker = true,
  showComposerStatus = true,
  showMainchainStatus = true,
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
  onRegenerate,
  connectionStatus,
}: AgentHubWorkbenchProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const translate = t as (key: string, options?: Record<string, unknown>) => string;

  const [activePage, setActivePage] = useState<GlobalRailPage>('chat');
  const isChatPage = activePage === 'chat';
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
    openInspector,
    shellStyle,
  } = useWorkbenchPanelLayout({
    activePage,
    isChatPage,
    platformSurface: platform.surface,
    setActivePage,
  });

  // Session owns composer/workspace refs and may run before transcript chrome is composed.
  // Bridge transcript helpers through a ref so user-driven handlers always see the latest impl.
  const transcriptHelpersRef = useRef({
    showWorkbenchToast: (_message: string) => {},
    copyText: (_text: string) => {},
    resetSelection: () => {},
  });

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
  } = useWorkbenchSessionChrome({
    platform,
    conversations,
    activeConversationId,
    onActiveConversationChange,
    agents,
    composerExecutionTargets,
    transcript,
    runtimeEvidence,
    workbenchStatus,
    activePage,
    isChatPage,
    openInspector,
    showWorkbenchToast: (message) => transcriptHelpersRef.current.showWorkbenchToast(message),
    copyText: (text) => transcriptHelpersRef.current.copyText(text),
    resetSelection: () => transcriptHelpersRef.current.resetSelection(),
    t: translate,
  });

  const {
    selectionMode,
    selectedBlockIds,
    softHiddenBlockIds,
    actionedBlockIds,
    contextMenu,
    setContextMenu,
    toastMessage,
    toastVisible,
    selectBarRect,
    multiSelectActions,
    contextMenuGroups,
    showWorkbenchToast,
    openBlockContextMenu,
    handleBlockSelect,
    handleTranscriptBlockAction,
    copyText,
    resetSelection,
  } = useWorkbenchTranscriptChrome({
    transcript,
    t: translate,
    onApprovalDecision,
    onRegenerate,
    dispatchComposer,
    composerInputRef,
    workspaceRef,
    inspectorCollapsed,
    inspectorWidth,
  });

  transcriptHelpersRef.current = {
    showWorkbenchToast,
    copyText,
    resetSelection,
  };

  const {
    activeAgentProfile,
    activeHumanProfile,
    activeGroupProfile,
    focusedAgentId,
    setActiveAgentProfile,
    setActiveHumanProfile,
    setActiveGroupProfile,
    openAgentProfile,
    openAgentProfileFromConfig,
    openConversationAvatar,
    openAgentDirectMessage,
    openHumanDirectMessage,
    openAgentConfig,
    openGroupConversation,
    copyHumanProfileLink,
  } = useWorkbenchProfileChrome({
    agents,
    conversations,
    t: translate,
    selectConversation,
    setActivePage,
    showWorkbenchToast,
    copyText,
    composerInputRef,
    onNavigateToConversation,
  });

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
        ref={workspaceRef}
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
              activePage={activePage}
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
      <WorkbenchTranscriptOverlays
        isChatPage={isChatPage}
        contextMenu={contextMenu}
        contextMenuGroups={contextMenuGroups}
        onCloseContextMenu={() => setContextMenu(null)}
        selectionMode={selectionMode}
        multiSelectActions={multiSelectActions}
        selectedCount={selectedBlockIds.length}
        totalCount={transcript.length}
        selectBarRect={selectBarRect}
        toastMessage={toastMessage}
        toastVisible={toastVisible}
      />
      <WorkbenchProfileOverlays
        t={translate}
        activeAgentProfile={activeAgentProfile}
        activeHumanProfile={activeHumanProfile}
        activeGroupProfile={activeGroupProfile}
        onCloseAgentProfile={() => setActiveAgentProfile(null)}
        onCloseHumanProfile={() => setActiveHumanProfile(null)}
        onCloseGroupProfile={() => setActiveGroupProfile(null)}
        onAgentDirectMessage={openAgentDirectMessage}
        onAgentConfig={openAgentConfig}
        onHumanDirectMessage={openHumanDirectMessage}
        onCopyHumanProfileLink={copyHumanProfileLink}
        onGroupSendMessage={openGroupConversation}
      />
    </div>
  );
}
