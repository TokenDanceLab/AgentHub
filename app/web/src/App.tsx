import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentHubWorkbench } from '@agenthub/workbench';
import { fetchAllPages } from '@shared/hub/paginate';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import type { AgentConfig, ContactMember, ProjectDraft, ProjectInfo, SkillMarketItem, MCPMarketItem } from '@agenthub/workbench';
import {
  allowsWorkbenchDemoRuntimeMutation,
  getWorkbenchDataModeContract,
  getWorkbenchDataModeOverrideSnapshot,
  resolveWorkbenchDataMode,
  subscribeWorkbenchDataModeOverride,
} from '@shared/demo';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import {
  useAgentList,
  useCreateAgentProfile,
  useDeleteAgentProfile,
  useUpdateAgentProfile,
} from '@/api/agentQueries';
import { createHubClient } from '@/api/hubClient';
import AuthPage from '@/components/AuthPage';
import { StartConversationModal } from '@/components/StartConversationModal';
import {
  createWebPlatform,
  resolveWebWorkbenchAgents,
} from '@/platform/webPlatform';
import { useWebWorkbenchModel } from '@/platform/useWebWorkbenchModel';
import { useWebAuth } from '@/hooks/useWebAuth';
import { getAccessToken, useAuth } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { deriveWorkbenchConnectionStatus, useConnectionStore } from '@/stores/connectionStore';
import { ToastContainer } from '@shared/ui/toast';
import styles from './App.module.css';

export default function App() {
  return (
    <>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <WebWorkbenchRoot />
        </ThemeProvider>
      </QueryClientProvider>
      <ToastContainer />
    </>
  );
}

function WebWorkbenchRoot() {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [agentActionError, setAgentActionError] = useState<string | undefined>();
  const [savingAgentId, setSavingAgentId] = useState<string | undefined>();
  const [deletingAgentId, setDeletingAgentId] = useState<string | undefined>();
  const { ensureAuth } = useWebAuth();
  const { logout } = useAuth();
  const sessionQueryClient = useQueryClient();
  const showAuthModal = useHubStore((state) => state.showAuthModal);
  const setShowAuthModal = useHubStore((state) => state.setShowAuthModal);
  // Live Hub WS state mirrored by useWebHubRealtime (#1816); surfaced as the
  // workbench connection indicator.
  const wsConnected = useConnectionStore((state) => state.isConnected);
  const wsReconnecting = useConnectionStore((state) => state.reconnecting);
  const connectionStatus = deriveWorkbenchConnectionStatus({
    isConnected: wsConnected,
    reconnecting: wsReconnecting,
  });
  const dataModeOverride = useSyncExternalStore(
    subscribeWorkbenchDataModeOverride,
    getWorkbenchDataModeOverrideSnapshot,
    getWorkbenchDataModeOverrideSnapshot,
  );
  const dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE, dataModeOverride || undefined);
  const dataModeContract = getWorkbenchDataModeContract(dataMode);
  const realMode = dataModeContract.isRealDataMode;
  const webPlatform = useMemo(
    () => createWebPlatform({
      ensureAuth,
      dataMode: dataModeContract.mode,
      // AH-SR-043: only explicit mock/fixture modes may use demo runtime fallback.
      // Never silent-fallback from auto/real/observed/approved-real.
      demoRuntimeFallback: allowsWorkbenchDemoRuntimeMutation({
        demoRuntimeFallback: true,
        dataMode: dataModeContract.mode,
      }),
    }),
    [dataModeContract.mode, ensureAuth],
  );
  const agentList = useAgentList(true);
  const createAgentProfile = useCreateAgentProfile();
  const updateAgentProfile = useUpdateAgentProfile();
  const deleteAgentProfile = useDeleteAgentProfile();
  const workbench = useWebWorkbenchModel(selectedConversationId, selectedProjectId);
  const chatActions = workbench.chatActions;
  const agents = resolveWebWorkbenchAgents(agentList.data?.items, dataMode);

  // Fetch real user profile from Hub (originates from TokenDance ID OIDC)
  const userProfile = useQuery({
    queryKey: ['web-v4', 'auth-me'],
    queryFn: () => createHubClient({ getToken: getAccessToken }).me(),
    enabled: Boolean(getAccessToken()),
    staleTime: 60_000,
  });
  const agentLoadError = realMode && agentList.error
    ? errorMessage(agentList.error, t('error.agentProfile.load'))
    : undefined;
  const hubClientForConversations = useMemo(() => createHubClient({ getToken: getAccessToken }), []);
  const hubReady = !realMode ? false : Boolean(getAccessToken());

  // Fetch public Skills for the Skill Market tab
  const skillMarketQuery = useQuery({
    queryKey: ['web-v4', 'public-skills', hubReady],
    // Was a parameterless first-page fetch: the market endpoint clamps to
    // MaxListPageSize (200) and returns page.nextCursor, which was dropped,
    // so the 51st skill never reached the market tab
    // (#2290 defect class). Canonical walk lives in @shared/hub/paginate.
    queryFn: () => fetchAllPages(hubClientForConversations.listPublicSkills),
    enabled: hubReady,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  // Fetch public MCP Servers for the MCP Market tab
  const mcpMarketQuery = useQuery({
    queryKey: ['web-v4', 'public-mcp-servers', hubReady],
    // Was a parameterless first-page fetch: the market endpoint clamps to
    // MaxListPageSize (200) and returns page.nextCursor, which was dropped,
    // so the 51st server never reached the market tab
    // (#2290 defect class). Canonical walk lives in @shared/hub/paginate.
    queryFn: () => fetchAllPages(hubClientForConversations.listPublicMCPServers),
    enabled: hubReady,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const skillMarketItems = useMemo<SkillMarketItem[]>(
    () => (skillMarketQuery.data?.items ?? []).map(normalizeHubSkillToMarketItem),
    [skillMarketQuery.data?.items],
  );
  const mcpMarketItems = useMemo<MCPMarketItem[]>(
    () => (mcpMarketQuery.data?.items ?? []).map(normalizeHubMcpToMarketItem),
    [mcpMarketQuery.data?.items],
  );

  const handleNavigateToConversation = useCallback(async (target: { name: string; id: string; kind: 'dm' | 'group' }) => {
    try {
      const result = await hubClientForConversations.createPrivateSession({ target_user_id: target.id });
      setSelectedConversationId(result.session_id);
    } catch {
      setSelectedConversationId(undefined);
    }
  }, [hubClientForConversations]);

  // #1819: sidebar "新建会话" — the Hub has no blank-session API (sessions
  // are always peer-bounded), so the direct entry opens the contact picker
  // and creates through the same real createPrivateSession chain the
  // Contacts page uses. Errors stay visible in the modal (never swallowed;
  // the legacy onNavigateToConversation catch → undefined is NOT copied).
  const [startConversationOpen, setStartConversationOpen] = useState(false);
  const [startConversationBusy, setStartConversationBusy] = useState(false);
  const [startConversationError, setStartConversationError] = useState<string | undefined>();

  const handleStartNewConversation = useCallback(() => {
    setStartConversationError(undefined);
    setStartConversationOpen(true);
  }, []);

  const handleStartConversation = useCallback(async (member: ContactMember) => {
    setStartConversationBusy(true);
    setStartConversationError(undefined);
    try {
      const result = await hubClientForConversations.createPrivateSession({ target_user_id: member.id });
      setStartConversationOpen(false);
      setSelectedConversationId(result.session_id);
    } catch (error) {
      setStartConversationError(t('error.startConversation', {
        detail: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setStartConversationBusy(false);
    }
  }, [hubClientForConversations, t]);

  async function handleAgentCreate(agent: AgentConfig): Promise<void> {
    setAgentActionError(undefined);
    setSavingAgentId(agent.id);
    try {
      await createAgentProfile.mutateAsync(agent);
    } catch (error) {
      setAgentActionError(errorMessage(error, t('error.agentProfile.create')));
      throw error;
    } finally {
      setSavingAgentId(undefined);
    }
  }

  async function handleAgentUpdate(agent: AgentConfig): Promise<void> {
    setAgentActionError(undefined);
    setSavingAgentId(agent.id);
    try {
      await updateAgentProfile.mutateAsync({ agent });
    } catch (error) {
      setAgentActionError(errorMessage(error, t('error.agentProfile.save')));
      throw error;
    } finally {
      setSavingAgentId(undefined);
    }
  }

  async function handleAgentDelete(agentId: string): Promise<void> {
    setAgentActionError(undefined);
    setDeletingAgentId(agentId);
    try {
      await deleteAgentProfile.mutateAsync(agentId);
    } catch (error) {
      setAgentActionError(errorMessage(error, t('error.agentProfile.delete')));
      throw error;
    } finally {
      setDeletingAgentId(undefined);
    }
  }

  async function handleProjectCreate(draft: ProjectDraft): Promise<ProjectInfo | undefined> {
    return workbench.projectsActions?.create(draft);
  }

  async function handleProjectUpdate(projectId: string, draft: ProjectDraft): Promise<ProjectInfo | undefined> {
    return workbench.projectsActions?.update(projectId, draft);
  }

  const handleLogout = useCallback(async (): Promise<void> => {
    await logout();
    sessionQueryClient.clear();
    setSelectedConversationId(undefined);
    setSelectedProjectId(undefined);
    setAgentActionError(undefined);
    setSavingAgentId(undefined);
    setDeletingAgentId(undefined);
    setShowAuthModal(true);
  }, [logout, sessionQueryClient, setShowAuthModal]);

  const agentProfilesStatus = useMemo(() => ({
    loading: realMode && agentList.isFetching,
    error: agentLoadError,
    actionError: agentActionError,
    savingAgentId,
    deletingAgentId,
  }), [realMode, agentList.isFetching, agentLoadError, agentActionError, savingAgentId, deletingAgentId]);

  const handleAgentsRetry = useCallback(() => {
    setAgentActionError(undefined);
    void agentList.refetch();
  }, [agentList]);

  const handleRegenerate = useCallback((_blockId: string, taskId: string): Promise<void> => {
    // #2274 B-1: the identity contract of POST /web/agent-tasks/:id/regenerate
    // is the TASK id (hub RegenerateAgentTask looks up pending_agent_tasks by
    // primary key). The pre-fix port stripped a `hub-message-` prefix and sent
    // what it called a "message id" — which is in fact the message's
    // client_msg_id, a third identifier domain — so every live click 404'd
    // (agent_task_not_found) and unauthenticated demo mode fired real
    // unauthenticated requests at the hub (401). The workbench chrome now
    // offers the entry only for blocks carrying the hub-stamped task id
    // (`agent_task.task_id` → block.agentTaskId) and passes it here.
    // #1821: return the real promise — the workbench chrome awaits it, so a
    // failed regenerate shows an error toast and keeps the message visible
    // instead of silently soft-hiding it behind a fake "regenerating" toast.
    return createHubClient({ getToken: getAccessToken })
      .regenerateAgentTask(taskId)
      .then(() => undefined);
  }, []);

  return (
    <>
      <AgentHubWorkbench
        activeConversationId={workbench.activeConversationId}
        agents={agents}
        composerExecutionTargets={workbench.composerExecutionTargets}
        devicesTargets={workbench.devicesTargets}
        devicesLoading={workbench.devicesLoading}
        devicesError={workbench.devicesError}
        onDevicesRetry={workbench.onDevicesRetry}
        devicesPingingId={workbench.devicesPingingId}
        onDevicePing={workbench.onDevicePing}
        usageTeams={workbench.usageTeams}
        usageLoading={workbench.usageLoading}
        usageError={workbench.usageError}
        onUsageRetry={workbench.onUsageRetry}
        connectionStatus={realMode ? connectionStatus : undefined}
        agentProfilesStatus={agentProfilesStatus}
        contacts={workbench.contacts}
        contactsError={workbench.contactsError}
        contactsActions={workbench.contactsActions}
        documents={workbench.documents}
        documentsError={workbench.documentsError}
        documentsActions={workbench.documentsActions}
        conversations={workbench.conversations}
        activeProjectId={selectedProjectId}
        projects={workbench.projects}
        projectsStatus={workbench.projectsStatus}
        onActiveConversationChange={setSelectedConversationId}
        onActiveProjectChange={setSelectedProjectId}
        onAgentCreate={handleAgentCreate}
        onAgentUpdate={handleAgentUpdate}
        onAgentDelete={handleAgentDelete}
        onAgentsRetry={handleAgentsRetry}
        onLogout={handleLogout}
        onProjectCreate={workbench.projectsActions ? handleProjectCreate : undefined}
        onProjectUpdate={workbench.projectsActions ? handleProjectUpdate : undefined}
        onApprovalDecision={workbench.onApprovalDecision}
        onNavigateToConversation={handleNavigateToConversation}
        onStartNewConversation={handleStartNewConversation}
        // #2274 B-1: regenerate is a real Hub mutation, so it rides the same
        // fail-closed gate as the other five chat actions — outside hubReady
        // (demo / unauthenticated) the port is undefined and the shared menu
        // hides the entry instead of offering a click that can only fail.
        onRegenerate={chatActions ? handleRegenerate : undefined}
        isAgentRunning={workbench.isAgentRunning}
        onCancelRun={workbench.onCancelRun}
        onEditMessage={
          chatActions
            ? async (blockId: string, content: string) => {
                await chatActions.onEditMessage(
                  blockId.replace(/^hub-message-/, ''),
                  content,
                );
              }
            : undefined
        }
        onPinMessage={
          chatActions
            ? (messageId: string, sessionId: string) =>
                // #1821: hand the chrome the real promise — success/failure
                // toasts ride its resolution instead of a swallowed rejection.
                chatActions.onPinMessage(
                  messageId.replace(/^hub-message-/, ''),
                  sessionId,
                )
            : undefined
        }
        onUnpinMessage={
          chatActions
            ? (messageId: string, sessionId: string) =>
                chatActions.onUnpinMessage(
                  messageId.replace(/^hub-message-/, ''),
                  sessionId,
                )
            : undefined
        }
        onForwardMessage={
          chatActions
            ? (messageId: string, targetSessionIds: string[]) =>
                chatActions.onForwardMessage(
                  messageId.replace(/^hub-message-/, ''),
                  targetSessionIds,
                )
            : undefined
        }
        onRecallMessage={
          chatActions
            ? (messageId: string) =>
                chatActions.onRecallMessage(
                  messageId.replace(/^hub-message-/, ''),
                )
            : undefined
        }
        onAddMessageReaction={
          chatActions
            ? (messageId: string, sessionId: string, emoji: string) =>
                chatActions.onAddReaction(
                  messageId.replace(/^hub-message-/, ''),
                  sessionId,
                  emoji,
                )
            : undefined
        }
        platform={webPlatform}
        runtimeEvidence={workbench.runtimeEvidence}
        showComposerAgentPicker
        showComposerStatus
        showMainchainStatus={false}
        workbenchStatus={workbench.workbenchStatus}
        transcript={workbench.transcript}
        transcriptLoading={workbench.transcriptLoading}
        userDisplayName={userProfile.data?.nickname || userProfile.data?.username}
        userAvatarUrl={userProfile.data?.avatar_url}
        currentUserId={userProfile.data?.id}
        skillMarketItems={skillMarketItems}
        skillMarketLoading={hubReady && skillMarketQuery.isFetching}
        {...(hubReady && skillMarketQuery.error
          ? { skillMarketError: errorMessage(skillMarketQuery.error, 'Skill market load failed') }
          : {})}
        mcpMarketItems={mcpMarketItems}
        mcpMarketLoading={hubReady && mcpMarketQuery.isFetching}
        {...(hubReady && mcpMarketQuery.error
          ? { mcpMarketError: errorMessage(mcpMarketQuery.error, 'MCP market load failed') }
          : {})}
      />
      {showAuthModal && (
        <div className={styles.authOverlay} role="presentation">
          <AuthPage
            onLoginSuccess={() => setShowAuthModal(false)}
            onClose={() => setShowAuthModal(false)}
          />
        </div>
      )}
      <StartConversationModal
        busy={startConversationBusy}
        error={startConversationError}
        members={workbench.contacts?.members ?? []}
        open={startConversationOpen}
        onClose={() => setStartConversationOpen(false)}
        onStart={(member) => { void handleStartConversation(member); }}
      />
    </>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function normalizeHubSkillToMarketItem(raw: Record<string, unknown>): SkillMarketItem {
  const item: SkillMarketItem = {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    skill_type: String(raw.skill_type ?? 'tool'),
  };
  if (raw.version != null) item.version = String(raw.version);
  if (typeof raw.install_count === 'number') item.install_count = raw.install_count;
  if (raw.is_public === true) item.is_public = true;
  if (raw.owner_id != null) item.owner_id = String(raw.owner_id);
  if (raw.created_at != null) item.created_at = String(raw.created_at);
  if (raw.updated_at != null) item.updated_at = String(raw.updated_at);
  return item;
}

function normalizeHubMcpToMarketItem(raw: Record<string, unknown>): MCPMarketItem {
  const item: MCPMarketItem = {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    transport: String(raw.transport ?? 'stdio'),
  };
  if (raw.command != null) item.command = String(raw.command);
  if (raw.url != null) item.url = String(raw.url);
  if (typeof raw.install_count === 'number') item.install_count = raw.install_count;
  if (raw.is_public === true) item.is_public = true;
  if (raw.owner_id != null) item.owner_id = String(raw.owner_id);
  if (raw.created_at != null) item.created_at = String(raw.created_at);
  if (raw.updated_at != null) item.updated_at = String(raw.updated_at);
  return item;
}
