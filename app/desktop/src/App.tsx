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
import { AgentHubWorkbench } from '@agenthub/workbench';
import { resolveCurrentTranscriptRunId } from '@shared/transcript';
import { getAgentActivityStore } from '@shared/transcript/agentActivity';
import type { ApprovalDecisionAction } from '@shared/transcript';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import { useAgentList } from '@/api/agentQueries';
import { useDecideTeamApproval, useTokenUsageBoard } from '@/api/agentTeamQueries';
import {
  useHubExecutionTargets,
  usePingHubExecutionTarget,
  type ExecutionTargetInventoryItem,
} from '@/api/executionTargetQueries';
import { useDocumentList, useCreateDocument, hubDocToDocRow } from '@/api/documentQueries';
import { useModelCatalog, useCCSwitchStatus, useCCSwitchProviders } from '@/api/modelCatalogQueries';
import { useRunEvidence } from '@/api/runEvidenceQueries';
import { useCreateRun, useCancelRun, useRuns, useDecideEdgePermission, findActiveEdgeRun } from '@/api/runQueries';
import { resolveEdgePermissionRunId } from '@/platform/edgeApprovalRouting';
import { useConnectionStore } from '@/stores/connectionStore';
import { useCreateThread, useCurrentUser, useThreads } from '@/api/threadQueries';
import { DesktopChrome } from '@/components/DesktopChrome';
import { DesktopEntryGate } from '@/components/DesktopEntryGate';
import DesktopHubTaskBridge from '@/components/DesktopHubTaskBridge';
import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { useHealth } from '@/hooks/useHealth';
import { useAuth } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { createDesktopPlatform } from '@/platform/desktopPlatform';
import { mapEdgeAgentsToWorkbenchAgents } from '@/platform/edgeCapabilityMapper';
import { useDesktopWorkbenchModel } from '@/platform/useDesktopWorkbenchModel';
import { createDesktopWorkbenchProjectsPort } from '@/platform/desktopWorkbenchProjectsPort';
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
import type { AgentConfig, ConnectionStatusKind, DevicesPageTarget, DocRow, SkillMarketItem, MCPMarketItem } from '@agenthub/workbench';
import { getDemoRuntimeEvidence } from '@/demo/demoEvidence';
import { useToastStore, ToastContainer } from '@shared/ui/toast';
import { friendlyErrorMessage } from '@shared/errorReporting';

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
  const onboardingSeen = useHubStore((s) => s.onboardingSeen);
  const setOnboardingSeen = useHubStore((s) => s.setOnboardingSeen);

  /* eslint-disable react-hooks/set-state-in-effect -- the entry→workbench
     transition must remain an effect: auth state arrives asynchronously from
     useAuth (subscription-less in tests), and deriving the mode instead would
     leave the workbench stale after logout until the next state change. */
  useEffect(() => {
    if (entryMode === 'entry' && isAuthenticated) {
      setEntryMode('workbench');
    }
  }, [entryMode, isAuthenticated]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
      {entryMode === 'workbench' && !onboardingSeen ? (
        <OnboardingOverlay onFinish={() => setOnboardingSeen(true)} />
      ) : null}
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

  // Desktop workbench state — the shared AgentHubWorkbench owns the global
  // keyboard dispatcher (#1822), so the former desktop-only
  // useGlobalKeyboardShortcuts hook is gone.

  const liveEdgeEnabled = edgeOnline && !workbench.isDemo;
  // In auto mode with Local Edge fallback, also fetch evidence from Edge API.
  const demoEdgeEnabled = edgeOnline && workbench.isDemo && workbench.edgeDemoData === true;
  const edgeFetchEnabled = liveEdgeEnabled || demoEdgeEnabled;
  const { data: agentData } = useAgentList(liveEdgeEnabled);
  const { data: modelCatalog } = useModelCatalog(liveEdgeEnabled);
  const { data: ccSwitchStatus } = useCCSwitchStatus(liveEdgeEnabled);
  const { data: ccSwitchProviders } = useCCSwitchProviders(undefined, liveEdgeEnabled);
  const {
    data: profileData,
    error: profileError,
    isFetching: profileFetching,
    refetch: refetchProfiles,
  } = useAgentProfileList(liveEdgeEnabled);
  const {
    data: hubProfileData,
    error: hubProfileError,
    refetch: refetchHubProfiles,
  } = useHubAgentProfiles({ enabled: !workbench.isDemo && !liveEdgeEnabled });
  const createAgentProfile = useCreateAgentProfile();
  const updateAgentProfile = useUpdateAgentProfile();
  const deleteAgentProfile = useDeleteAgentProfile();
  const [agentActionError, setAgentActionError] = useState<string | undefined>();
  const [savingAgentId, setSavingAgentId] = useState<string | undefined>();
  const [deletingAgentId, setDeletingAgentId] = useState<string | undefined>();
  const createRun = useCreateRun();
  const cancelRun = useCancelRun();
  const decideEdgePermission = useDecideEdgePermission();
  const createThread = useCreateThread();
  const decideTeamApproval = useDecideTeamApproval();
  const { data: threadsData } = useThreads(undefined, { enabled: liveEdgeEnabled });
  // Edge run lifecycle for the active thread — the authoritative source for
  // the running state (composer stop button) and the cancel target (#1816 W1).
  const runsQuery = useRuns(undefined, workbench.activeThreadId, {
    enabled: liveEdgeEnabled && Boolean(workbench.activeThreadId),
  });
  const { data: currentUser } = useCurrentUser(edgeOnline);
  const { data: documentListData, error: documentListError } = useDocumentList(undefined, { enabled: liveEdgeEnabled });
  const createDocumentMutation = useCreateDocument();

  // Fetch public Skills for the Skill Market tab
  const hubClient = getHubClient();
  const hubReady = !workbench.isDemo;

  // ── Devices / execution-target management page (#1819) ─────────────
  // Real Hub inventory (health detail + ping), not the composer's filtered
  // subset. Undefined in demo mode so the page shows sign-in guidance.
  const devicesTargetsQuery = useHubExecutionTargets({ enabled: hubReady });
  const pingExecutionTarget = usePingHubExecutionTarget();
  const devicesTargets = useMemo(
    () => (hubReady
      ? (devicesTargetsQuery.data?.items ?? []).map(mapDesktopExecutionTargetToDeviceEntry)
      : undefined),
    [hubReady, devicesTargetsQuery.data],
  );
  const handleDevicePing = useCallback((targetId: string) => {
    pingExecutionTarget.mutate(targetId, {
      onSuccess: () => {
        showToast('success', t('devices.pingOk'));
      },
      onError: (err) => {
        showToast('error', t('devices.pingFailed', { detail: friendlyErrorMessage(err instanceof Error ? err.message : String(err), t('error.network')) }));
      },
    });
  }, [pingExecutionTarget, showToast, t]);

  // ── Token usage board (#1819) ──────────────────────────────────────
  const usageBoard = useTokenUsageBoard(hubReady);
  const usageTeams = useMemo(
    () => (hubReady ? usageBoard.data ?? [] : undefined),
    [hubReady, usageBoard.data],
  );
  // Narrow domain port for workbench project data (#1546); the shared UI never
  // sees the concrete HubClient. Injected only in live mode — parent-managed
  // projects keep the port dormant while demo mode falls back to mock fixtures.
  const desktopProjectsPort = useMemo(() => createDesktopWorkbenchProjectsPort(tIm), [tIm]);
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
    () => (liveEdgeEnabled && documentListData?.items ? documentListData.items.map((doc) => hubDocToDocRow(doc, tIm)) : undefined),
    [liveEdgeEnabled, documentListData],
  );
  const documentsError = useMemo(
    () => (liveEdgeEnabled && documentListError
      ? (documentListError instanceof Error ? documentListError.message : String(documentListError))
      : undefined),
    [liveEdgeEnabled, documentListError],
  );
  const documentsActions = useMemo(() => ({
    onCreateDoc: liveEdgeEnabled ? async () => { await createDocumentMutation.mutateAsync({ title: t('doc.untitled') }); } : undefined,
  }), [liveEdgeEnabled, createDocumentMutation, t]);

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
    [createRun, queryClient, workbench.activeThreadId, showToast, t],
  );

  /* eslint-disable react-hooks/refs -- submitRunWithRefresh reads submitRunRef
     only inside its async event-handler body, never during render; the rule
     conservatively flags passing a ref-reading callback into the render-time
     createDesktopPlatform factory. */
  const desktopPlatform = useMemo(() => createDesktopPlatform({
    ...(workbench.activeProjectId ? { activeProjectId: workbench.activeProjectId } : {}),
    ...(workbench.activeThreadId ? { activeThreadId: workbench.activeThreadId } : {}),
    ...(edgeOnline ? { submitRun: submitRunWithRefresh } : {}),
    demoRuntimeFallback: workbench.isDemo && workbench.edgeDemoData !== true,
  }), [submitRunWithRefresh, workbench.activeProjectId, workbench.activeThreadId, edgeOnline, workbench.edgeDemoData, workbench.isDemo]);
  /* eslint-enable react-hooks/refs */
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

  const chatActions = workbench.chatActions;

  const handleActiveProjectChange = useCallback((projectId: string) => {
    if (workbench.isDemo) return;
    const thread = threadsData?.items?.find((t) => t.projectId === projectId);
    if (thread) setSelectedConversationId(thread.threadId);
  }, [threadsData?.items, workbench.isDemo]);

  // Still-active Edge run in the current thread, from the run lifecycle query.
  const activeEdgeRun = useMemo(
    () => findActiveEdgeRun(runsQuery.data?.items),
    [runsQuery.data?.items],
  );

  // An agent run is "active" while the Edge run list still holds a
  // non-terminal run for the thread, or the SSE-fed agent activity shows
  // dispatching/thinking/streaming (mirrors the web isAgentRunning contract,
  // #1462 CF13 stop-button morph).
  const isAgentRunning = useMemo(() => {
    if (!liveEdgeEnabled) return false;
    if (activeEdgeRun) return true;
    return (workbench.agentActivity?.activeAgents ?? []).some(
      (agent) =>
        agent.status === 'dispatching' ||
        agent.status === 'thinking' ||
        agent.status === 'streaming',
    );
  }, [liveEdgeEnabled, activeEdgeRun, workbench.agentActivity]);

  const handleCancelRun = useCallback(() => {
    // Prefer the authoritative run list; fall back to the run id carried by
    // the current transcript when the list has not caught up yet.
    const runId = activeEdgeRun?.runId ?? activeRunId;
    if (!runId) return;
    void cancelRun.mutateAsync(runId).catch((error: unknown) => {
      showToast(
        'error',
        t('error.cancelRunFailed', {
          detail: friendlyErrorMessage(
            error instanceof Error ? error.message : undefined,
            t('error.unknown'),
          ),
        }),
      );
    });
  }, [activeEdgeRun, activeRunId, cancelRun, showToast, t]);

  const handleApprovalDecision = useCallback(async (action: ApprovalDecisionAction) => {
    if (action.teamId && action.teamRunId) {
      await decideTeamApproval.mutateAsync({
        teamId: action.teamId,
        runId: action.teamRunId,
        approvalId: action.approvalId,
        decision: { decision: action.decision },
      });
      return;
    }
    // Hub-owned approvals (team or agent-task) without a complete team
    // context have no local route — never mis-send them to the Local Edge.
    // Note: a local Edge permission block can carry teamRunId alone (the
    // mapper derives it from payload.runId), so teamRunId by itself must not
    // block the Local Edge route below.
    if (action.teamId || action.agentTaskId) return;
    // Local Edge run permission (#1816 W1): the card's requestId doubles as
    // the Edge permission requestId; the owning runId comes from the
    // permission_request block's run evidence, falling back to the active
    // run of the current transcript.
    if (!liveEdgeEnabled) return;
    const runId = resolveEdgePermissionRunId(workbench.transcript, action.approvalId) ?? activeRunId;
    if (!runId) return;
    await decideEdgePermission.mutateAsync({
      runId,
      requestId: action.approvalId,
      decision: action.decision,
    });
  }, [decideTeamApproval, decideEdgePermission, liveEdgeEnabled, workbench.transcript, activeRunId]);

  // Real desktop connection state for the workbench rail dot (#1816 W1):
  // Local Edge is the primary execution link, so Edge-down means
  // disconnected; while the Hub WS transport is still establishing we show
  // connecting. Demo mode has no real link and hides the dot.
  const hubWsStatus = useConnectionStore((state) => state.connectionStatus);
  const connectionStatus = useMemo<ConnectionStatusKind | undefined>(() => {
    if (workbench.isDemo) return undefined;
    if (!edgeOnline) return 'disconnected';
    if (hubWsStatus === 'connecting' || hubWsStatus === 'reconnecting') return 'connecting';
    return 'connected';
  }, [workbench.isDemo, edgeOnline, hubWsStatus]);

  // Device kicked by the Hub (#1816 W1): hubEventBridge surfaces the toast
  // and flags the store; the shell reacts by returning to the login entry
  // with the regular logout cleanup.
  const kickedReason = useConnectionStore((state) => state.kickedReason);
  useEffect(() => {
    if (!kickedReason) return;
    useConnectionStore.getState().clearKicked();
    onLogout?.();
  }, [kickedReason, onLogout]);

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
        avatarColor: 'var(--td-plum)',
      };
      workbenchDemoRuntimeStore.addConversation(newConversation);
      setSelectedConversationId(target.id);
    } else {
      void createThread.mutateAsync({ title: target.name }).then((thread) => {
        setSelectedConversationId(thread.threadId);
      });
    }
  }, [createThread, workbench.conversations, workbench.isDemo]);

  // #1819: sidebar "新建会话" direct entry. Live: real Edge thread creation
  // (the same createThread chain handleNavigateToConversation uses for a
  // named target, here with an auto-title that the first message refines).
  // Errors surface as a toast — never swallowed.
  const handleStartNewConversation = useCallback(() => {
    if (workbench.isDemo) {
      const conversationId = `demo-new-${Date.now()}`;
      const title = t('sidebar.newConversation');
      workbenchDemoRuntimeStore.addConversation({
        id: conversationId,
        title,
        kind: 'direct',
        avatarLabel: title.slice(0, 1),
        avatarColor: 'var(--td-plum)',
      });
      setSelectedConversationId(conversationId);
      return;
    }
    createThread.mutateAsync({})
      .then((thread) => {
        setSelectedConversationId(thread.threadId);
      })
      .catch((error: unknown) => {
        showToast('error', t('error.startConversation', {
          detail: friendlyErrorMessage(
            error instanceof Error ? error.message : undefined,
            t('error.unknown'),
          ),
        }));
      });
  }, [createThread, showToast, t, workbench.isDemo]);

  // #1821: error must not collapse into a permanent skeleton — surface the
  // query error (aligned with the Web RecoveryPanel contract) and make retry
  // a real refetch instead of a no-op.
  const agentLoadError = liveEdgeEnabled
    ? agentProfileErrorMessage(profileError ?? hubProfileError, tIm)
    : undefined;
  const agentProfilesStatus = useMemo(() => ({
    loading: liveEdgeEnabled && profileFetching && profileData?.items === undefined,
    ...(agentLoadError !== undefined ? { error: agentLoadError } : {}),
    ...(agentActionError !== undefined ? { actionError: agentActionError } : {}),
    savingAgentId,
    deletingAgentId,
  }), [liveEdgeEnabled, profileFetching, profileData?.items, agentLoadError, agentActionError, savingAgentId, deletingAgentId]);

  const handleAgentsRetry = useCallback(() => {
    setAgentActionError(undefined);
    void refetchProfiles();
    void refetchHubProfiles();
  }, [refetchProfiles, refetchHubProfiles]);

  const workbenchStatus = useMemo(() => ({
    dataMode: workbench.dataMode,
    targetState: workbench.edgeDemoData ? 'observed' : workbench.isDemo ? 'mock' : edgeOnline ? 'online' : 'offline',
    targetLabel: workbench.edgeDemoData ? 'Local Edge observed (auto)' : workbench.isDemo ? 'Demo runtime' : 'Local Edge',
    initialLoading: workbench.threadsLoading === true && workbench.conversations.length === 0,
    ...((workbench.threadsError ?? workbench.itemsError) !== undefined
      ? { loadError: (workbench.threadsError ?? workbench.itemsError) as string }
      : {}),
  }), [workbench.dataMode, workbench.edgeDemoData, workbench.isDemo, edgeOnline, workbench.threadsLoading, workbench.conversations.length, workbench.threadsError, workbench.itemsError]);

  return (
    <>
      {liveEdgeEnabled ? <DesktopHubTaskBridge /> : null}
      <AgentHubWorkbench
        activeConversationId={workbench.activeConversationId}
        agents={agents}
        agentProfilesStatus={agentProfilesStatus}
        contacts={workbench.contacts}
        contactsError={workbench.contactsError}
        contactsActions={workbench.contactsActions}
        documents={documents}
        documentsError={documentsError}
        documentsActions={documentsActions}
        conversations={workbench.conversations}
        onActiveConversationChange={setSelectedConversationId}
        onAgentCreate={handleAgentCreate}
        onAgentUpdate={handleAgentUpdate}
        onAgentDelete={handleAgentDelete}
        onAgentsRetry={handleAgentsRetry}
        onLogout={onLogout}
        onNavigateToConversation={handleNavigateToConversation}
        onStartNewConversation={handleStartNewConversation}
        onEditMessage={
          chatActions
            ? async (blockId: string, content: string) => {
                await chatActions.editMessage(
                  blockId.replace(/^hub-message-/, ''),
                  content,
                );
              }
            : undefined
        }
        /* #2154: Desktop already owns these Hub mutations
           (useDesktopWorkbenchModel → DesktopChatActions) but never forwarded
           them, while the shared menu gate only checked the session id —
           `activeConversationId` doubles as one — so Desktop rendered
           pin/unpin/recall entries whose clicks the effect dispatcher dropped
           without a word. Forwarding the ports makes those entries real.
           forward/regenerate/reaction stay undefined: Desktop has no mutation
           for them, and the menu is now fail-closed per handler, so the
           entries stay hidden instead of offering a dead click. */
        onPinMessage={
          chatActions
            ? async (messageId: string, sessionId: string) => {
                await chatActions.pinMessage(
                  messageId.replace(/^hub-message-/, ''),
                  sessionId,
                );
              }
            : undefined
        }
        onUnpinMessage={
          chatActions
            ? async (messageId: string, sessionId: string) => {
                await chatActions.unpinMessage(
                  messageId.replace(/^hub-message-/, ''),
                  sessionId,
                );
              }
            : undefined
        }
        onRecallMessage={
          chatActions
            ? async (messageId: string) => {
                await chatActions.recallMessage(
                  messageId.replace(/^hub-message-/, ''),
                );
              }
            : undefined
        }
        onProjectCreate={workbench.projectsActions?.create}
        onProjectUpdate={workbench.projectsActions?.update}
        projectsPort={hubReady ? desktopProjectsPort : undefined}
        onApprovalDecision={handleApprovalDecision}
        isAgentRunning={isAgentRunning}
        onCancelRun={liveEdgeEnabled ? handleCancelRun : undefined}
        connectionStatus={connectionStatus}
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
        transcriptLoading={workbench.itemsLoading}
        userDisplayName={currentUser?.displayName}
        userAvatarUrl={currentUser?.avatarUrl}
        skillMarketItems={skillMarketItems}
        skillMarketLoading={hubReady && skillMarketQuery.isFetching}
        {...(hubReady && skillMarketQuery.error
          ? { skillMarketError: desktopMarketErrorMessage(skillMarketQuery.error, tIm('market.skillLoadFailed')) }
          : {})}
        mcpMarketItems={mcpMarketItems}
        mcpMarketLoading={hubReady && mcpMarketQuery.isFetching}
        {...(hubReady && mcpMarketQuery.error
          ? { mcpMarketError: desktopMarketErrorMessage(mcpMarketQuery.error, tIm('market.mcpLoadFailed')) }
          : {})}
        devicesTargets={devicesTargets}
        devicesLoading={devicesTargetsQuery.isFetching && !devicesTargetsQuery.data}
        devicesError={
          devicesTargetsQuery.error
            ? (devicesTargetsQuery.error instanceof Error ? devicesTargetsQuery.error.message : String(devicesTargetsQuery.error))
            : null
        }
        onDevicesRetry={() => { void devicesTargetsQuery.refetch(); }}
        devicesPingingId={pingExecutionTarget.isPending ? (pingExecutionTarget.variables ?? null) : null}
        onDevicePing={handleDevicePing}
        usageTeams={usageTeams}
        usageLoading={usageBoard.isFetching && !usageBoard.data}
        usageError={
          usageBoard.error
            ? (usageBoard.error instanceof Error ? usageBoard.error.message : String(usageBoard.error))
            : null
        }
        onUsageRetry={() => { void usageBoard.refetch(); }}
        workbenchStatus={workbenchStatus}
      />
    </>
  );
}

/** Extract a user-facing message from an agent-profile query error (#1821). */
function agentProfileErrorMessage(error: unknown, t?: (key: string) => string): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error && error.message.trim()) return error.message;
  return t?.('agentConfigLoadFailed') ?? 'Agent 配置加载失败';
}

/** Extract a user-facing message from a market query error (#1821). */
function desktopMarketErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function mapDesktopExecutionTargetToDeviceEntry(
  target: ExecutionTargetInventoryItem,
): DevicesPageTarget {
  const id = String(target.id ?? '');
  return {
    id,
    name: target.name ? String(target.name) : id,
    targetType: String(target.target_type),
    healthState: String(target.health_state),
    isOnline: target.is_online === true,
    ...(target.trust_level ? { trustLevel: String(target.trust_level) } : {}),
    ...(target.endpoint ? { endpoint: String(target.endpoint) } : {}),
    ...(target.workspace_root ? { workspaceRoot: String(target.workspace_root) } : {}),
    ...(target.device_id ? { deviceId: String(target.device_id) } : {}),
    ...(target.last_seen_at ? { lastSeenAt: String(target.last_seen_at) } : {}),
  };
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
