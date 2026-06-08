import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { AgentHubWorkbench } from '@shared/workbench';
import type { AgentConfig, ProjectDraft, ProjectInfo } from '@shared/workbench';
import {
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
import AuthPage from '@/components/AuthPage';
import {
  createWebPlatform,
  resolveWebWorkbenchAgents,
} from '@/platform/webPlatform';
import { useWebWorkbenchModel } from '@/platform/useWebWorkbenchModel';
import { useWebAuth } from '@/hooks/useWebAuth';
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
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [agentActionError, setAgentActionError] = useState<string | undefined>();
  const [savingAgentId, setSavingAgentId] = useState<string | undefined>();
  const [deletingAgentId, setDeletingAgentId] = useState<string | undefined>();
  const { ensureAuth } = useWebAuth();
  const showAuthModal = useHubStore((state) => state.showAuthModal);
  const setShowAuthModal = useHubStore((state) => state.setShowAuthModal);
  const webPlatform = useMemo(() => createWebPlatform({ ensureAuth }), [ensureAuth]);
  const dataModeOverride = useSyncExternalStore(
    subscribeWorkbenchDataModeOverride,
    getWorkbenchDataModeOverrideSnapshot,
    getWorkbenchDataModeOverrideSnapshot,
  );
  const dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE, dataModeOverride || undefined);
  const agentList = useAgentList(true);
  const createAgentProfile = useCreateAgentProfile();
  const updateAgentProfile = useUpdateAgentProfile();
  const deleteAgentProfile = useDeleteAgentProfile();
  const workbench = useWebWorkbenchModel(selectedConversationId);
  const agents = resolveWebWorkbenchAgents(agentList.data?.items, dataMode);
  const agentLoadError = dataMode === 'real' && agentList.error
    ? errorMessage(agentList.error, 'Agent Profile 加载失败')
    : undefined;

  async function handleAgentCreate(agent: AgentConfig): Promise<void> {
    setAgentActionError(undefined);
    setSavingAgentId(agent.id);
    try {
      await createAgentProfile.mutateAsync(agent);
    } catch (error) {
      setAgentActionError(errorMessage(error, 'Agent Profile 创建失败'));
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
      setAgentActionError(errorMessage(error, 'Agent Profile 保存失败'));
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
      setAgentActionError(errorMessage(error, 'Agent Profile 删除失败'));
      throw error;
    } finally {
      setDeletingAgentId(undefined);
    }
  }

  async function handleProjectCreate(draft: ProjectDraft): Promise<ProjectInfo | void> {
    return workbench.projectsActions?.create(draft);
  }

  async function handleProjectUpdate(projectId: string, draft: ProjectDraft): Promise<ProjectInfo | void> {
    return workbench.projectsActions?.update(projectId, draft);
  }

  return (
    <>
      <AgentHubWorkbench
        activeConversationId={workbench.activeConversationId}
        agents={agents}
        composerExecutionTargets={workbench.composerExecutionTargets}
        agentProfilesStatus={{
          loading: dataMode === 'real' && agentList.isFetching,
          error: agentLoadError,
          actionError: agentActionError,
          savingAgentId,
          deletingAgentId,
        }}
        contacts={workbench.contacts}
        conversations={workbench.conversations}
        projects={workbench.projects}
        projectsStatus={workbench.projectsStatus}
        onActiveConversationChange={setSelectedConversationId}
        onAgentCreate={handleAgentCreate}
        onAgentUpdate={handleAgentUpdate}
        onAgentDelete={handleAgentDelete}
        onAgentsRetry={() => {
          setAgentActionError(undefined);
          void agentList.refetch();
        }}
        onProjectCreate={workbench.projectsActions ? handleProjectCreate : undefined}
        onProjectUpdate={workbench.projectsActions ? handleProjectUpdate : undefined}
        platform={webPlatform}
        transcript={workbench.transcript}
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
