import React from 'react';
import { useCallback, useMemo } from 'react';
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
import { sumUsageTeamTokens } from './workbenchUsageSummary';
import {
  buildActiveConversationAttention,
  findFirstAwaitingConversationId,
  summarizeWorkbenchAttention,
} from './workbenchAttentionModel';
import {
  ChatConversationHostFrame,
  ChatInspectorFrame,
  ChatSidebarFrame,
  WorkbenchRoutesFrame,
  WorkspaceLoadErrorState,
  WorkspaceLoadingState,
} from './WorkbenchFrameParts';
import { WorkbenchSplitHost } from './WorkbenchSplitHost';
import { SplitConversationPane } from './SplitConversationPane';
import { useSplitTranscriptCache } from './workbenchSplitTranscriptCache';
import { findConversationById } from './workbenchSessionChromeHelpers';
import type { WorkbenchSplitControls } from './workbenchFrameTypes';
import type { GroupLeaf } from './workbenchSplitLayout';
import styles from './AgentHubWorkbench.module.css';
import { TerminalPanel } from './terminal';
import { MainchainStatusStrip } from './MainchainStatusStrip';
import { WORKBENCH_APPROVAL_JUMP_EVENT } from './workbenchApprovalEvents';
import { firstPendingApprovalBlockId } from './workbenchApprovalSummary';
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
  onStartNewConversation,
  contactsActions,
  contactsError,
  documents,
  documentsError,
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
  attention,
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
    split,
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

  /* ── Split view (#1997, UX F3): sidebar selection first routes through the
     split layout (≥2 panes → the conversation drops into an inactive pane),
     then performs the normal single-active selection. ── */
  const handleSidebarSelectConversation = useCallback((conversationId: string): void => {
    split?.placeConversation(conversationId);
    selectConversation(conversationId);
  }, [split, selectConversation]);
  const {
    focusedAgentId,
    openAgentProfileFromConfig,
    openConversationAvatar,
  } = profile;

  /* ── F1/F6 attention: one derivation feeds sidebar dots, rail badge and
     status-strip counts so the surfaces never disagree. Inventory mode uses
     the shell's run/approval/thread arrays; otherwise the active-conversation
     fallback observes what the workbench already holds client-side (pending
     approvals in the active transcript + the runtime running flag) and marks
     the summary `activeConversationOnly` so surfaces scope their copy. ── */
  const attentionSummary = useMemo(
    () => (attention
      ? summarizeWorkbenchAttention(attention)
      : buildActiveConversationAttention({
          activeConversationId: currentConversationId,
          transcript,
          isAgentRunning,
        })),
    [attention, currentConversationId, transcript, isAgentRunning],
  );
  const openRunningQueue = useCallback(() => navigateRail('runs'), [navigateRail]);
  // #1990 (UX F14): live usage chip — aggregate the usage board's recorded
  // token counters (same real data the Usage page renders); undefined keeps
  // the chip honestly hidden when the shell has no Hub usage data.
  const usageTokenTotal = useMemo(() => sumUsageTeamTokens(usageTeams), [usageTeams]);
  const openUsagePage = useCallback(() => navigateRail('usage'), [navigateRail]);
  const openApprovalQueueFallback = useCallback(() => {
    if (!attentionSummary) return;
    const target = findFirstAwaitingConversationId(
      conversations,
      attentionSummary.liveStatusByConversation,
    );
    if (target && target !== currentConversationId) selectConversation(target);
  }, [attentionSummary, conversations, currentConversationId, selectConversation]);

  // #1994 (UX F5): the global status bar owns the awaiting-approval chip.
  // On the chat page a click asks the mounted ConversationHost to jump within
  // the active transcript (transient intent); elsewhere the bar first returns
  // to chat and selects the first awaiting conversation.
  const firstPendingApprovalId = useMemo(
    () => firstPendingApprovalBlockId(transcript),
    [transcript],
  );
  const handleOpenApprovalQueue = useCallback((): void => {
    if (isChatPage && firstPendingApprovalId) {
      window.dispatchEvent(new CustomEvent(WORKBENCH_APPROVAL_JUMP_EVENT, {
        detail: { conversationId: currentConversationId },
      }));
      return;
    }
    setActivePage('chat');
    openApprovalQueueFallback();
  }, [isChatPage, firstPendingApprovalId, currentConversationId, setActivePage, openApprovalQueueFallback]);

  /* ── Split view state + chrome (#1997, UX F3) ───────────────────────────
     Honesty gate: no split entry renders with fewer than two conversations.
     The active pane's header gets Split Right/Down + Move to Group +
     Unsplit; read-only panes get focus/move/close. ── */
  const splitActive = split?.active ?? false;
  const splitAllowed = Boolean(split) && conversations.length >= 2;
  const splitTranscriptCache = useSplitTranscriptCache(currentConversationId, transcript);

  const paneTitleOf = useCallback((leaf: GroupLeaf): string => {
    if (!leaf.conversationId) return '';
    return findConversationById(conversations, leaf.conversationId)?.title ?? leaf.conversationId;
  }, [conversations]);

  const buildMoveTargets = useCallback((excludePaneId?: string): WorkbenchSplitControls['moveTargets'] => {
    if (!split) return [];
    return split.panes
      .filter((pane) => pane.paneId !== excludePaneId && pane.conversationId !== currentConversationId)
      .map((pane) => ({
        paneId: pane.paneId,
        title: pane.conversationId
          ? (findConversationById(conversations, pane.conversationId)?.title ?? pane.conversationId)
          : t('split.emptyPaneTarget'),
      }));
  }, [split, conversations, currentConversationId, t]);

  // Memoized: ConversationHost is React.memo — a fresh controls object every
  // shell render (keystrokes) would bust its memo gate (#perf).
  const activeSplitControls = useMemo((): WorkbenchSplitControls | undefined => {
    if (!splitAllowed || !split) return undefined;
    return {
      hasSplit: splitActive,
      moveTargets: splitActive ? buildMoveTargets() : [],
      onSplitRight: () => split.splitActivePane('horizontal'),
      onSplitDown: () => split.splitActivePane('vertical'),
      onUnsplit: split.collapseAll,
      onMoveToPane: (targetPaneId: string): void => {
        const activeLeaf = currentConversationId
          ? split.panes.find((pane) => pane.conversationId === currentConversationId)
          : undefined;
        if (activeLeaf) split.moveConversationToPane(activeLeaf.paneId, targetPaneId);
      },
    };
  }, [splitAllowed, split, splitActive, buildMoveTargets, currentConversationId]);

  const renderReadOnlyPane = useCallback((leaf: GroupLeaf): React.ReactElement => {
    const conversation = leaf.conversationId
      ? findConversationById(conversations, leaf.conversationId)
      : undefined;
    const paneControls: WorkbenchSplitControls | undefined = splitAllowed && split
      ? {
          hasSplit: true,
          moveTargets: buildMoveTargets(leaf.paneId).filter((target) => target.paneId !== leaf.paneId),
          onUnsplit: () => split.unsplitPane(leaf.paneId),
          onMoveToPane: (targetPaneId: string): void => {
            split.moveConversationToPane(leaf.paneId, targetPaneId);
          },
        }
      : undefined;
    return (
      <SplitConversationPane
        paneId={leaf.paneId}
        conversation={conversation}
        transcript={(leaf.conversationId && splitTranscriptCache.get(leaf.conversationId)) || []}
        {...(attentionSummary && leaf.conversationId && attentionSummary.liveStatusByConversation[leaf.conversationId]
          ? { liveStatus: attentionSummary.liveStatusByConversation[leaf.conversationId] }
          : {})}
        {...(paneControls ? { splitControls: paneControls } : {})}
        onFocus={(): void => {
          if (leaf.conversationId) selectConversation(leaf.conversationId);
        }}
        onClose={(): void => split?.unsplitPane(leaf.paneId)}
      />
    );
  }, [split, splitAllowed, conversations, splitTranscriptCache, attentionSummary, selectConversation, buildMoveTargets]);

  const chatHostElement = (
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
      {...(activeSplitControls ? { splitControls: activeSplitControls } : {})}
    />
  );

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
        {...(attentionSummary ? { attention: attentionSummary } : {})}
      />
      {isChatPage && (
        <ChatSidebarFrame
          conversations={conversations}
          currentConversationId={currentConversationId}
          onSelectConversation={handleSidebarSelectConversation}
          onAvatarClick={openConversationAvatar}
          onConversationPin={onConversationPin}
          onConversationArchive={onConversationArchive}
          onStartNewConversation={onStartNewConversation}
          {...(attentionSummary
            ? { liveStatusByConversation: attentionSummary.liveStatusByConversation }
            : {})}
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
        {...(splitActive ? { 'data-split': 'true' } : {})}
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
          split ? (
            <WorkbenchSplitHost
              tree={split.tree}
              splitActive={splitActive}
              activeConversationId={currentConversationId}
              activeHost={chatHostElement}
              renderReadOnlyPane={renderReadOnlyPane}
              paneTitleOf={paneTitleOf}
            />
          ) : (
            chatHostElement
          )
        ) : (
          <WorkbenchRoutesFrame
            activePage={activePage as Exclude<GlobalRailPage, 'chat'>}
            platformSurface={platform.surface}
            agents={agents}
            agentProfilesStatus={agentProfilesStatus}
            dataMode={workbenchStatus?.dataMode}
            contacts={contacts}
            contactsError={contactsError}
            documents={documents}
            documentsError={documentsError}
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
      {/* #1994 (UX F5): global bottom status bar — visible on every rail
          page; conversation chain segments only on the chat page. */}
      <MainchainStatusStrip
        {...(connectionStatus ? { connectionStatus } : {})}
        showConversationChain={isChatPage && showMainchainStatus}
        summary={session.mainchainSummary}
        onExportEvidence={session.exportMainchainEvidence}
        {...(attentionSummary ? { attention: attentionSummary } : {})}
        onOpenRunningQueue={openRunningQueue}
        onOpenApprovalQueue={handleOpenApprovalQueue}
        {...(usageTokenTotal !== undefined
          ? { usageTokenTotal, onOpenUsage: openUsagePage }
          : {})}
      />
      {children}
    </div>
  );
}
