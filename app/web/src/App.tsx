import { QueryClientProvider } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { AgentHubWorkbench } from '@shared/workbench';
import type { AgentConfig } from '@shared/workbench';
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
import {
  createWebPlatform,
  resolveWebWorkbenchAgents,
} from '@/platform/webPlatform';
import { useWebWorkbenchModel } from '@/platform/useWebWorkbenchModel';

const webPlatform = createWebPlatform();

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

  return (
    <AgentHubWorkbench
      activeConversationId={workbench.activeConversationId}
      agents={agents}
      agentProfilesStatus={{
        loading: dataMode === 'real' && agentList.isFetching,
        error: agentLoadError,
        actionError: agentActionError,
        savingAgentId,
        deletingAgentId,
      }}
      contacts={workbench.contacts}
      conversations={workbench.conversations}
      onActiveConversationChange={setSelectedConversationId}
      onAgentCreate={handleAgentCreate}
      onAgentUpdate={handleAgentUpdate}
      onAgentDelete={handleAgentDelete}
      onAgentsRetry={() => {
        setAgentActionError(undefined);
        void agentList.refetch();
      }}
      platform={webPlatform}
      transcript={workbench.transcript}
    />
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
