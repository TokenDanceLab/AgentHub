import React from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalRail, type GlobalRailPage } from './GlobalRail';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import {
  buildTerminalPanelDockProps,
  buildWorkbenchShellDataAttrs,
  buildWorkspaceMainDataAttrs,
  shouldRenderTerminalDock,
} from './workbenchFrameHelpers';
import type { WorkbenchFrameProps } from './workbenchFrameTypes';
import {
  ChatConversationHostFrame,
  ChatInspectorFrame,
  ChatSidebarFrame,
  WorkbenchRoutesFrame,
  WorkspaceLoadErrorState,
  WorkspaceLoadingState,
} from './WorkbenchFrameParts';
import styles from './AgentHubWorkbench.module.css';
import { TerminalPanel } from './terminal';
import { useExiting } from '@shared/ui/useExiting';

export type { WorkbenchFrameProps } from './workbenchFrameTypes';

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
  projectsPort,
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
  transcriptUnreadDivider,
  userDisplayName,
  userAvatarUrl,
  currentUserId,
  skillMarketItems,
  skillMarketLoading,
  skillMarketError,
  mcpMarketItems,
  mcpMarketLoading,
  mcpMarketError,
  highlightedBlockId,
  onHighlightEnd,
  connectionStatus,
  isAgentRunning,
  onCancelRun,
  onEditMessage,
  transcriptLoading,
  devicesTargets,
  devicesLoading,
  devicesError,
  onDevicesRetry,
  devicesPingingId,
  onDevicePing,
  usageTeams,
  usageLoading,
  usageError,
  onUsageRetry,
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
    localCliDiscovery,
    sessionImportItems,
    sessionImportLoading,
    sessionImportError,
    sessionImportVisible,
    refreshSessionImport,
    workspaceRef,
    handleToggleTheme,
  } = session;
  const { selectionMode } = transcriptChrome;
  const {
    focusedAgentId,
    openAgentProfileFromConfig,
    openConversationAvatar,
  } = profile;

  const shellDataAttrs = buildWorkbenchShellDataAttrs({
    inspectorCollapsed,
    inspectorResizing,
    activePage,
    selectionMode,
    sidebarCollapsed,
    sidebarResizing,
    dataMode: workbenchStatus?.dataMode,
  });
  const workspaceDataAttrs = buildWorkspaceMainDataAttrs({
    showMainchainStatus,
    isChatPage,
    surface: platform.surface,
  });

  const loadError = workbenchStatus?.loadError;
  // Prefer a visible recovery panel over spinner → blank chat (#1010).
  const showLoadError = Boolean(isChatPage && loadError);
  const showInitialLoading = Boolean(
    !showLoadError && workbenchStatus?.initialLoading && conversations.length === 0,
  );

  // Terminal dock mount/unmount choreography (#1825): keep the dock mounted
  // 180ms while the exit animation plays; instant flip under reduced motion.
  const dockVisible = shouldRenderTerminalDock({
    isChatPage,
    localTerminal: platform.capabilities.localTerminal,
  });
  const { mounted: dockMounted, exiting: dockExiting } = useExiting(dockVisible, 180);

  return (
    <div
      className={styles.shell}
      {...shellDataAttrs}
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
        <ChatSidebarFrame
          conversations={conversations}
          currentConversationId={currentConversationId}
          onSelectConversation={selectConversation}
          onAvatarClick={openConversationAvatar}
          onConversationPin={onConversationPin}
          onConversationArchive={onConversationArchive}
          sidebarWidth={sidebarWidth}
          sidebarCollapsed={sidebarCollapsed}
          resizeSidebarBy={resizeSidebarBy}
          beginSidebarResize={beginSidebarResize}
        />
      )}

      <main
        ref={workspaceRef as React.RefObject<HTMLElement>}
        aria-label={t('aria.workspace')}
        className={styles.workspace}
        id="main-content"
        {...workspaceDataAttrs}
      >
        {showLoadError ? (
          <WorkspaceLoadErrorState
            title={t('connection.loadErrorTitle')}
            description={t('connection.loadErrorDescription')}
            meta={loadError}
            retryLabel={t('connection.retry')}
          />
        ) : showInitialLoading ? (
          <WorkspaceLoadingState label={t('connection.connecting')} />
        ) : isChatPage ? (
          <ChatConversationHostFrame
            platform={platform}
            session={session}
            transcriptChrome={transcriptChrome}
            profile={profile}
            transcript={transcript}
            transcriptUnreadDivider={transcriptUnreadDivider}
            connectionStatus={connectionStatus}
            inspectorCollapsed={inspectorCollapsed}
            toggleInspector={toggleInspector}
            showMainchainStatus={showMainchainStatus}
            workbenchStatus={workbenchStatus}
            composerExecutionTargets={composerExecutionTargets}
            showComposerAgentPicker={showComposerAgentPicker}
            showComposerStatus={showComposerStatus}
            highlightedBlockId={highlightedBlockId}
            onHighlightEnd={onHighlightEnd}
            isAgentRunning={isAgentRunning}
            onCancelRun={onCancelRun}
            onEditMessage={onEditMessage}
            transcriptLoading={transcriptLoading}
          />
        ) : (
          <WorkbenchRoutesFrame
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
            projectsPort={projectsPort}
            onAgentCreate={onAgentCreate}
            onAgentUpdate={onAgentUpdate}
            onAgentDelete={onAgentDelete}
            onAgentsRetry={onAgentsRetry}
            onAgentProfileOpen={openAgentProfileFromConfig}
            onStartConversation={onNavigateToConversation}
            contactsActions={contactsActions}
            documentsActions={documentsActions}
            localCliDiscovery={localCliDiscovery}
            sessionImportItems={sessionImportItems}
            sessionImportLoading={sessionImportLoading}
            sessionImportError={sessionImportError}
            sessionImportVisible={sessionImportVisible}
            onRefreshSessionImport={refreshSessionImport}
            modelCatalog={modelCatalog}
            ccSwitchStatus={ccSwitchStatus}
            ccSwitchProviders={ccSwitchProviders}
            settingsService={settingsService}
            skillMarketItems={skillMarketItems}
            skillMarketLoading={skillMarketLoading}
            skillMarketError={skillMarketError}
            mcpMarketItems={mcpMarketItems}
            mcpMarketLoading={mcpMarketLoading}
            mcpMarketError={mcpMarketError}
            onNavigatePage={setActivePage}
            currentUserId={currentUserId}
            userDisplayName={userDisplayName}
            devicesTargets={devicesTargets}
            devicesLoading={devicesLoading}
            devicesError={devicesError}
            onDevicesRetry={onDevicesRetry}
            devicesPingingId={devicesPingingId}
            onDevicePing={onDevicePing}
            usageTeams={usageTeams}
            usageLoading={usageLoading}
            usageError={usageError}
            onUsageRetry={onUsageRetry}
          />
        )}
      </main>

      {isChatPage && (
        <ChatInspectorFrame
          platform={platform}
          session={session}
          runtimeEvidence={runtimeEvidence}
          inspectorCollapsed={inspectorCollapsed}
          inspectorWidth={inspectorWidth}
          resizeInspectorBy={resizeInspectorBy}
          beginInspectorResize={beginInspectorResize}
        />
      )}
      {dockMounted && (
        <div
          className={`${styles.terminalDock}${dockExiting ? ` ${styles.terminalDockExiting}` : ''}`}
          data-testid="workbench-terminal-dock"
          data-local-terminal="enabled"
        >
          <TerminalPanel {...buildTerminalPanelDockProps(platform)} />
        </div>
      )}
      {children}
    </div>
  );
}
