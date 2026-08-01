import { useMemo, useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  WORKBENCH_DATA_MODE_STORAGE_KEY,
  getWorkbenchDataModeContract,
  getWorkbenchDataModeOverrideSnapshot,
  resolveWorkbenchDataMode,
  subscribeWorkbenchDataModeOverride,
  writeWorkbenchDataModeOverride,
  workbenchDemoRuntimeStore,
} from '@shared/demo';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import type { UnreadDividerDescriptor } from '@shared/chatview';
import { toggleAppliedAgentHubTheme } from '@shared/theme';
import { AgentHubWorkbench } from '@shared/workbench';
import { resolveCurrentTranscriptRunId } from '@shared/transcript';
import { getAgentActivityStore } from '@shared/transcript/agentActivity';
import type { ApprovalDecisionAction } from '@shared/transcript';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import { useAgentList } from '@/api/agentQueries';
import { useDecideTeamApproval } from '@/api/agentTeamQueries';
import { useDocumentList, useCreateDocument, hubDocToDocRow } from '@/api/documentQueries';
import { useModelCatalog, useCCSwitchStatus, useCCSwitchProviders } from '@/api/modelCatalogQueries';
import { useRunEvidence } from '@/api/runEvidenceQueries';
import { useCreateRun } from '@/api/runQueries';
import { useCreateThread, useCurrentUser, useThreads } from '@/api/threadQueries';
import { DesktopChrome } from '@/components/DesktopChrome';
import { DesktopEntryGate } from '@/components/DesktopEntryGate';
import DesktopHubTaskBridge from '@/components/DesktopHubTaskBridge';
import { useHealth } from '@/hooks/useHealth';
import { useAuth } from '@/hooks/useAuth';
import { createDesktopPlatform } from '@/platform/desktopPlatform';
import { mapEdgeAgentsToWorkbenchAgents } from '@/platform/edgeCapabilityMapper';
import { useDesktopWorkbenchModel } from '@/platform/useDesktopWorkbenchModel';
import {
  useAgentProfileList,
  useCreateAgentProfile,
  useUpdateAgentProfile,
  useDeleteAgentProfile,
  edgeAgentProfileToWorkbenchAgent,
  useHubAgentProfiles,
  hubAgentProfileToWorkbenchAgent,
} from '@/api/agentProfileQueries';
import { getHubClient } from '@/api/hubQueries';
import type { AgentConfig, DocRow, SkillMarketItem, MCPMarketItem } from '@shared/workbench';
import { getDemoRuntimeEvidence } from '@/demo/demoEvidence';
import { useToastStore } from '@/stores/toastStore';
import { ToastContainer } from '@/components/Toast';
import { useGlobalKeyboardShortcuts } from '@/hooks/useGlobalKeyboardShortcuts';

export default function App() {
  const [entryMode, setEntryMode] = useState<'entry' | 'workbench'>('entry');
  const dataModeOverride = useSyncExternalStore(
    subscribeWorkbenchDataModeOverride,
    getWorkbenchDataModeOverrideSnapshot,
    getWorkbenchDataModeOverrideSnapshot,
  );
  const dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE, dataModeOverride);
  const dataModeContract = getWorkbenchDataModeContract(dataMode);
  const edgeHealthEnabled = entryMode === 'entry' ||
    dataModeContract.requiresLocalEdgeForDesktop ||
    dataModeContract.allowsLocalEdgeAutoFallback;
  const { online: edgeOnline } = useHealth({ enabled: edgeHealthEnabled });
  const queryClient = useQueryClient();
  const { isAuthenticated, logout } = useAuth();

  // If a callback or stored session has established auth, leave the entry gate.
  // Do this as an effect rather than mutating state during render.
  useEffect(() => {
    if (entryMode === 'entry' && isAuthenticated) {
      setEntryMode('workbench');
    }
  }, [entryMode, isAuthenticated]);

  function continueDemo(): void {
    writeWorkbenchDataModeOverride('mock');
    setEntryMode('workbench');
  }

  function handleConnectEdge(): void {
    writeWorkbenchDataModeOverride('observed');
    setEntryMode('workbench');
  }

  function handleLoginSuccess(): void {
    writeWorkbenchDataModeOverride('approved-real');
    setEntryMode('workbench');
  }

  const handleLogout = useCallback(async (): Promise<void> => {
    await logout();
    queryClient.clear();
    window.localStorage.removeItem(WORKBENCH_DATA_MODE_STORAGE_KEY);
    setEntryMode('entry');
  }, [logout, queryClient]);

  return (
    <>
      <DesktopChrome showNavigationControls={entryMode !== 'entry'}>
        {entryMode === 'entry' ? (
          <DesktopEntryGate
            onLoginSuccess={handleLoginSuccess}
            onContinueDemo={continueDemo}
            onConnectEdge={handleConnectEdge}
            onToggleTheme={toggleAppliedAgentHubTheme}
            edgeOnline={edgeOnline}
          />
        ) : (
          <DesktopWorkbenchApp onLogout={handleLogout} />
        )}
      </DesktopChrome>
      <ToastContainer />
    </>
  );
}

export interface DesktopWorkbenchAppProps {
  onLogout?: (() => void) | undefined;
}

export function DesktopWorkbenchApp({ onLogout }: DesktopWorkbenchAppProps = {}) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  // Default namespace — desktop locale keys (im.session.*) for the IM transcript
  // unread divider copy (T8).
  const { t: tIm } = useTranslation();
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const workbench = useDesktopWorkbenchModel(selectedConversationId, t);
  const { online: edgeOnline } = useHealth({ enabled: !workbench.isDemo || workbench.edgeDemoData === true });
  const queryClient = useQueryClient();
  const submitRunRef = useRef(false);
  const agentsRef = useRef<WorkbenchAgent[] | undefined>(undefined);
  const showToast = useToastStore((s) => s.showToast);

  // Central keyboard shortcut dispatch
  useGlobalKeyboardShortcuts();

  const liveEdgeEnabled = edgeOnline && !workbench.isDemo;
  // In auto mode with Local Edge fallback, also fetch evidence from Edge API.
  const demoEdgeEnabled = edgeOnline && workbench.isDemo && workbench.edgeDemoData === true;
  const edgeFetchEnabled = liveEdgeEnabled || demoEdgeEnabled;
  const { data: agentData } = useAgentList(liveEdgeEnabled);
  const { data: modelCatalog } = useModelCatalog(liveEdgeEnabled);
  const { data: ccSwitchStatus } = useCCSwitchStatus(liveEdgeEnabled);
  const { data: ccSwitchProviders } = useCCSwitchProviders(undefined, liveEdgeEnabled);
  const { data: profileData } = useAgentProfileList(liveEdgeEnabled);
  const { data: hubProfileData } = useHubAgentProfiles({ enabled: !workbench.isDemo && !liveEdgeEnabled });
  const createAgentProfile = useCreateAgentProfile();
  const updateAgentProfile = useUpdateAgentProfile();
  const deleteAgentProfile = useDeleteAgentProfile();
  const [agentActionError, setAgentActionError] = useState<string | undefined>();
  const [savingAgentId, setSavingAgentId] = useState<string | undefined>();
  const [deletingAgentId, setDeletingAgentId] = useState<string | undefined>();
  const createRun = useCreateRun();
  const createThread = useCreateThread();
  const decideTeamApproval = useDecideTeamApproval();
  const { data: threadsData } = useThreads(undefined, { enabled: liveEdgeEnabled });
  const { data: currentUser } = useCurrentUser(edgeOnline);
  const { data: documentListData } = useDocumentList(undefined, { enabled: liveEdgeEnabled });
  const createDocumentMutation = useCreateDocument();

  // Fetch public Skills for the Skill Market tab
  const hubClient = getHubClient();
  const hubReady = !workbench.isDemo;
  const skillMarketQuery = useQuery({
    queryKey: ['desktop', 'public-skills', hubReady],
    queryFn: () => hubClient.listPublicSkills(),
    enabled: hubReady,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  // Fetch public MCP Servers for the MCP Market tab
  const mcpMarketQuery = useQuery({
    queryKey: ['desktop', 'public-mcp-servers', hubReady],
    queryFn: () => hubClient.listPublicMCPServers(),
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

  const documents = useMemo<DocRow[] | undefined>(
    () => (liveEdgeEnabled && documentListData?.items ? documentListData.items.map(hubDocToDocRow) : undefined),
    [liveEdgeEnabled, documentListData?.items],
  );
  const documentsActions = useMemo(() => ({
    onCreateDoc: liveEdgeEnabled ? async () => { await createDocumentMutation.mutateAsync({ title: t('doc.untitled') }); } : undefined,
  }), [liveEdgeEnabled, createDocumentMutation]);

  const activeRunId = useMemo(() => {
    if (!workbench.activeThreadId && !demoEdgeEnabled) return undefined;
    return resolveCurrentTranscriptRunId(workbench.transcript);
  }, [workbench.activeThreadId, workbench.transcript, demoEdgeEnabled]);

  // IM transcript unread divider (T8): desktop-owned copy over the
  // workbench-computed read-watermark marker.
  const transcriptUnreadDivider = useMemo<UnreadDividerDescriptor | undefined>(() => {
    const marker = workbench.transcriptUnread;
    if (!marker) return undefined;
    return {
      anchorBlockId: marker.anchorBlockId,
      count: marker.count,
      label: tIm('im.session.unread', { count: marker.count }),
      ...(marker.readThroughSeq !== undefined
        ? { readThrough: tIm('im.session.readThrough', { seq: marker.readThroughSeq }) }
        : {}),
    };
  }, [workbench.transcriptUnread, tIm]);
  // In auto mode with an available Local Edge, also fetch run evidence from Edge API.
  const edgeRunEvidence = useRunEvidence(edgeFetchEnabled ? activeRunId : undefined);

  // Auto mode with Local Edge fallback uses Edge API evidence; explicit mock/fixture use JS data.
  // Real mode: always use Edge API evidence.
  const runtimeEvidence = workbench.isDemo
    ? (demoEdgeEnabled && activeRunId
      ? {
          runId: activeRunId,
          diffs: edgeRunEvidence.diffs,
          artifacts: edgeRunEvidence.artifacts,
          previews: edgeRunEvidence.previews,
          loading: {
            diff: edgeRunEvidence.diffLoading,
            artifacts: edgeRunEvidence.artifactLoading,
            previews: edgeRunEvidence.previewLoading,
          },
          errors: {
            diff: edgeRunEvidence.diffError,
            artifacts: edgeRunEvidence.artifactError,
            previews: edgeRunEvidence.previewError,
          },
          sources: {
            diff: edgeRunEvidence.diffSource,
            artifacts: edgeRunEvidence.artifactSource,
            previews: edgeRunEvidence.previewSource,
          },
        }
      : getDemoRuntimeEvidence(workbench.activeConversationId))
    : (activeRunId ? {
        runId: activeRunId,
        diffs: edgeRunEvidence.diffs,
        artifacts: edgeRunEvidence.artifacts,
        previews: edgeRunEvidence.previews,
        loading: {
          diff: edgeRunEvidence.diffLoading,
          artifacts: edgeRunEvidence.artifactLoading,
          previews: edgeRunEvidence.previewLoading,
        },
        errors: {
          diff: edgeRunEvidence.diffError,
          artifacts: edgeRunEvidence.artifactError,
          previews: edgeRunEvidence.previewError,
        },
        sources: {
          diff: edgeRunEvidence.diffSource,
          artifacts: edgeRunEvidence.artifactSource,
          previews: edgeRunEvidence.previewSource,
        },
      } : undefined);
  // Wrap submitRun to invalidate thread items after run creation so the transcript
  // refreshes to show new agent messages. The invalidation is immediate plus a few
  // delayed follow-ups to catch async agent responses that arrive after the run starts.
  const submitRunWithRefresh = useCallback(
    async (req: Parameters<typeof createRun.mutateAsync>[0]) => {
      if (submitRunRef.current) {
        showToast('warning', t('toast.requestRunning'));
        return undefined as unknown as ReturnType<typeof createRun.mutateAsync>;
      }
      submitRunRef.current = true;
      // Immediately show a "dispatching" indicator so the user knows
      // the request was received.  The Edge SSE bridge in
      // useDesktopEdgeEvents will update the status to thinking/streaming
      // once the run actually starts.
      const pendingRunId = `pending-${Date.now()}`;
      getAgentActivityStore().pushAgentStatus(
        pendingRunId,
        agentsRef.current?.[0]?.name ?? 'Agent',
        'dispatching',
      );
      try {
        const threadId = req?.threadId ?? workbench.activeThreadId;
        const run = await createRun.mutateAsync(req);
        // Once we get a real runId back, swap the pending entry for the real one.
        const realRunId = run?.runId;
        if (realRunId) {
          getAgentActivityStore().state.activeAgents.delete(pendingRunId);
        }
        // Immediate invalidation — useCreateRun.onSettled also does this, but we
        // additionally schedule delayed re-fetches for the agent's async response.
        if (threadId) {
          void queryClient.invalidateQueries({ queryKey: ['threadItems', threadId] });
          // Follow-up invalidations at 2s and 4s to catch agent responses.
          setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['threadItems', threadId] }), 2_000);
          setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['threadItems', threadId] }), 4_000);
        }
        return run;
      } catch (err) {
        // On failure, clean up the pending entry.
        getAgentActivityStore().state.activeAgents.delete(pendingRunId);
        throw err;
      } finally {
        submitRunRef.current = false;
      }
    },
    [createRun.mutateAsync, queryClient, workbench.activeThreadId, showToast],
  );

  const desktopPlatform = useMemo(() => createDesktopPlatform({
    ...(workbench.activeProjectId ? { activeProjectId: workbench.activeProjectId } : {}),
    ...(workbench.activeThreadId ? { activeThreadId: workbench.activeThreadId } : {}),
    ...(edgeOnline ? { submitRun: submitRunWithRefresh } : {}),
    demoRuntimeFallback: workbench.isDemo && workbench.edgeDemoData !== true,
  }), [submitRunWithRefresh, workbench.activeProjectId, workbench.activeThreadId, edgeOnline, workbench.edgeDemoData, workbench.isDemo]);
  const edgeAgents = useMemo(
    () => mapEdgeAgentsToWorkbenchAgents(agentData?.items ?? [], modelCatalog),
    [agentData?.items, modelCatalog],
  );

  // Merge strategy: Edge profiles (user-configured) take priority over raw adapter list.
  // When profiles exist, they represent the user's saved agent configurations.
  // When no profiles exist yet, fall back to the raw adapter list.
  // When Edge is offline, fall back to Hub agent profiles.
  const agents = useMemo(() => {
    if (workbench.isDemo) return workbench.agents;
    const profiles = profileData?.items;
    if (profiles && profiles.length > 0) {
      return profiles.map(edgeAgentProfileToWorkbenchAgent);
    }
    // Hub fallback when Edge is offline
    const hubProfiles = hubProfileData;
    if (hubProfiles && hubProfiles.length > 0) {
      return hubProfiles.map(hubAgentProfileToWorkbenchAgent);
    }
    return edgeAgents;
  }, [workbench.isDemo, workbench.agents, profileData?.items, hubProfileData, edgeAgents]);

  // Keep agentsRef in sync so submitRunWithRefresh can read it without being
  // declared after it.
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  async function handleAgentCreate(agent: AgentConfig): Promise<void> {
    setAgentActionError(undefined);
    setSavingAgentId(agent.id);
    try {
      await createAgentProfile.mutateAsync(agent);
    } catch (error) {
      setAgentActionError(error instanceof Error ? error.message : t('error.agentProfile.create'));
      throw error;
    } finally {
      setSavingAgentId(undefined);
    }
  }

  async function handleAgentUpdate(agent: AgentConfig): Promise<void> {
    setAgentActionError(undefined);
    setSavingAgentId(agent.id);
    try {
      await updateAgentProfile.mutateAsync({ id: agent.id, agent });
    } catch (error) {
      setAgentActionError(error instanceof Error ? error.message : t('error.agentProfile.save'));
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
      setAgentActionError(error instanceof Error ? error.message : t('error.agentProfile.delete'));
      throw error;
    } finally {
      setDeletingAgentId(undefined);
    }
  }

  const handleActiveProjectChange = useCallback((projectId: string) => {
    if (workbench.isDemo) return;
    const thread = threadsData?.items?.find((t) => t.projectId === projectId);
    if (thread) setSelectedConversationId(thread.threadId);
  }, [threadsData?.items, workbench.isDemo]);

  const handleApprovalDecision = useCallback(async (action: ApprovalDecisionAction) => {
    if (!action.teamId || !action.teamRunId) return;
    await decideTeamApproval.mutateAsync({
      teamId: action.teamId,
      runId: action.teamRunId,
      approvalId: action.approvalId,
      decision: { decision: action.decision },
    });
  }, [decideTeamApproval]);

  const handleNavigateToConversation = useCallback((target: { name: string; id: string; kind: 'dm' | 'group' }) => {
    if (workbench.isDemo) {
      const existing = workbench.conversations.find((c) => c.id === target.id || c.title === target.name);
      if (existing) {
        setSelectedConversationId(existing.id);
        return;
      }
      const newConversation: WorkbenchConversation = {
        id: target.id,
        title: target.name,
        kind: target.kind === 'group' ? 'group' : 'direct',
        avatarLabel: target.name.slice(0, 1).toUpperCase(),
        avatarColor: 'var(--primary)',
      };
      workbenchDemoRuntimeStore.addConversation(newConversation);
      setSelectedConversationId(target.id);
    } else {
      void createThread.mutateAsync({ title: target.name }).then((thread) => {
        setSelectedConversationId(thread.threadId);
      });
    }
  }, [createThread, workbench.conversations, workbench.isDemo]);

  return (
    <>
      {liveEdgeEnabled ? <DesktopHubTaskBridge /> : null}
      <AgentHubWorkbench
        activeConversationId={workbench.activeConversationId}
        agents={agents}
        agentProfilesStatus={{
          loading: liveEdgeEnabled && (profileData?.items === undefined),
          error: agentActionError,
          actionError: agentActionError,
          savingAgentId,
          deletingAgentId,
        }}
        contacts={workbench.contacts}
        contactsActions={workbench.contactsActions}
        documents={documents}
        documentsActions={documentsActions}
        conversations={workbench.conversations}
        onActiveConversationChange={setSelectedConversationId}
        onAgentCreate={handleAgentCreate}
        onAgentUpdate={handleAgentUpdate}
        onAgentDelete={handleAgentDelete}
        onAgentsRetry={() => {
          setAgentActionError(undefined);
        }}
        onLogout={onLogout}
        onNavigateToConversation={handleNavigateToConversation}
        onEditMessage={
          workbench.chatActions
            ? async (blockId: string, content: string) => {
                await workbench.chatActions!.editMessage(
                  blockId.replace(/^hub-message-/, ''),
                  content,
                );
              }
            : undefined
        }
        onProjectCreate={workbench.projectsActions?.create}
        onProjectUpdate={workbench.projectsActions?.update}
        onApprovalDecision={handleApprovalDecision}
        activeProjectId={workbench.activeProjectId}
        onActiveProjectChange={handleActiveProjectChange}
          modelCatalog={modelCatalog?.items}
          ccSwitchStatus={ccSwitchStatus ? {
            installed: ccSwitchStatus.installed,
            routingActive: ccSwitchStatus.routingActive,
            ...(ccSwitchStatus.proxyPort != null ? { proxyPort: ccSwitchStatus.proxyPort } : {}),
            ...(ccSwitchStatus.activeAppTypes ? { activeAppTypes: ccSwitchStatus.activeAppTypes } : {}),
          } : undefined}
          ccSwitchProviders={ccSwitchProviders?.map((p) => ({
            providerId: p.providerId,
            providerName: p.providerName,
            appType: p.appType,
            isCurrent: p.isCurrent,
            isActive: p.isActive,
            ...(p.modelAliases ? { modelAliases: p.modelAliases } : {}),
          }))}
        platform={desktopPlatform}
        projects={workbench.projects}
        projectsStatus={workbench.projectsStatus}
        runtimeEvidence={runtimeEvidence}
        showComposerAgentPicker={false}
        showComposerStatus={false}
        showMainchainStatus={false}
        transcript={workbench.transcript}
        transcriptUnreadDivider={transcriptUnreadDivider}
        userDisplayName={currentUser?.displayName}
        userAvatarUrl={currentUser?.avatarUrl}
        skillMarketItems={skillMarketItems}
        skillMarketLoading={hubReady && skillMarketQuery.isFetching}
        mcpMarketItems={mcpMarketItems}
        mcpMarketLoading={hubReady && mcpMarketQuery.isFetching}
        workbenchStatus={{
          dataMode: workbench.dataMode,
          targetState: workbench.edgeDemoData ? 'observed' : workbench.isDemo ? 'mock' : edgeOnline ? 'online' : 'offline',
          targetLabel: workbench.edgeDemoData ? 'Local Edge observed (auto)' : workbench.isDemo ? 'Demo runtime' : 'Local Edge',
          initialLoading: workbench.threadsLoading === true && workbench.conversations.length === 0,
          ...((workbench.threadsError ?? workbench.itemsError) !== undefined
            ? { loadError: (workbench.threadsError ?? workbench.itemsError) as string }
            : {}),
        }}
      />
    </>
  );
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
