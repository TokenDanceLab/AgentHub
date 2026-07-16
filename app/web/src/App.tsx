import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentHubWorkbench } from '@shared/workbench';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import type { AgentConfig, ProjectDraft, ProjectInfo, SkillMarketItem, MCPMarketItem } from '@shared/workbench';
import {
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
import {
  createWebPlatform,
  resolveWebWorkbenchAgents,
} from '@/platform/webPlatform';
import { useWebWorkbenchModel } from '@/platform/useWebWorkbenchModel';
import { useWebAuth } from '@/hooks/useWebAuth';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import styles from './App.module.css';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WebWorkbenchRoot />
      </ThemeProvider>
    </QueryClientProvider>
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
  const showAuthModal = useHubStore((state) => state.showAuthModal);
  const setShowAuthModal = useHubStore((state) => state.setShowAuthModal);
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
      // AH-SR-043: only explicit mock/fixture modes may use demo runtime fallback.
      // Never silent-fallback from auto/real/observed/approved-real.
      demoRuntimeFallback:
        (dataModeContract.mode === 'mock' || dataModeContract.mode === 'fixture') &&
        dataModeContract.allowsDemoRuntimeFallback,
    }),
    [dataModeContract.allowsDemoRuntimeFallback, dataModeContract.mode, ensureAuth],
  );
  const agentList = useAgentList(true);
  const createAgentProfile = useCreateAgentProfile();
  const updateAgentProfile = useUpdateAgentProfile();
  const deleteAgentProfile = useDeleteAgentProfile();
  const workbench = useWebWorkbenchModel(selectedConversationId, selectedProjectId);
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
    queryFn: () => hubClientForConversations.listPublicSkills(),
    enabled: hubReady,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  // Fetch public MCP Servers for the MCP Market tab
  const mcpMarketQuery = useQuery({
    queryKey: ['web-v4', 'public-mcp-servers', hubReady],
    queryFn: () => hubClientForConversations.listPublicMCPServers(),
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

  return (
    <>
      <AgentHubWorkbench
        activeConversationId={workbench.activeConversationId}
        agents={agents}
        composerExecutionTargets={workbench.composerExecutionTargets}
        agentProfilesStatus={{
          loading: realMode && agentList.isFetching,
          error: agentLoadError,
          actionError: agentActionError,
          savingAgentId,
          deletingAgentId,
        }}
        contacts={workbench.contacts}
        contactsActions={workbench.contactsActions}
        conversations={workbench.conversations}
        activeProjectId={selectedProjectId}
        projects={workbench.projects}
        projectsStatus={workbench.projectsStatus}
        onActiveConversationChange={setSelectedConversationId}
        onActiveProjectChange={setSelectedProjectId}
        onAgentCreate={handleAgentCreate}
        onAgentUpdate={handleAgentUpdate}
        onAgentDelete={handleAgentDelete}
        onAgentsRetry={() => {
          setAgentActionError(undefined);
          void agentList.refetch();
        }}
        onProjectCreate={workbench.projectsActions ? handleProjectCreate : undefined}
        onProjectUpdate={workbench.projectsActions ? handleProjectUpdate : undefined}
        onApprovalDecision={workbench.onApprovalDecision}
        onNavigateToConversation={handleNavigateToConversation}
        onRegenerate={(blockId) => {
          const messageId = blockId.replace(/^hub-message-/, '');
          void createHubClient({ getToken: getAccessToken }).regenerateAgentTask(messageId).catch(() => {});
        }}
        platform={webPlatform}
        runtimeEvidence={workbench.runtimeEvidence}
        showComposerAgentPicker
        showComposerStatus
        showMainchainStatus={false}
        workbenchStatus={workbench.workbenchStatus}
        transcript={workbench.transcript}
        userDisplayName={userProfile.data?.nickname || userProfile.data?.username}
        userAvatarUrl={userProfile.data?.avatar_url}
        currentUserId={userProfile.data?.id}
        skillMarketItems={skillMarketItems}
        skillMarketLoading={hubReady && skillMarketQuery.isFetching}
        mcpMarketItems={mcpMarketItems}
        mcpMarketLoading={hubReady && mcpMarketQuery.isFetching}
      />
      {showAuthModal && (
        <div className={styles.authOverlay} role="presentation">
          <AuthPage
            onLoginSuccess={() => setShowAuthModal(false)}
            onClose={() => setShowAuthModal(false)}
          />
        </div>
      )}
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
