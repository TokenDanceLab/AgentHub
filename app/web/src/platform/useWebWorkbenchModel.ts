import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import type { ProjectDraft } from '@agenthub/workbench';
import {
  getWorkbenchDataModeContract,
  getWorkbenchDataModeOverrideSnapshot,
  resolveWorkbenchDataMode,
  subscribeWorkbenchDataModeOverride,
} from '@shared/demo';
import {
  resolveHubContacts,
  type HubContactLike,
} from '@agenthub/workbench/hubDataMapping';
import {
  getAgentActivityStore,
  getPinMapStore,
  withPinnedState,
  type ApprovalDecisionAction,
  type HubRuntimeEventTranscriptInput,
} from '@shared/transcript';
import { useToastStore } from '@shared/ui/toast';
import { createHubClient, type Session } from '@/api/hubClient';
import {
  useHubExecutionTargets,
  usePingHubExecutionTarget,
  type ExecutionTargetInventoryItem,
} from '@/api/executionTargetQueries';
import { useTokenUsageBoard } from '@/api/tokenUsageQueries';
import type { DevicesPageTarget } from '@agenthub/workbench';
import {
  useCreateHubWorkspaceProject,
  useHubWorkspaceProjectThreadMessages,
  useHubWorkspaceProjectThreads,
  useHubWorkspaceProject,
  useHubWorkspaceProjects,
  useUpdateHubWorkspaceProject,
} from '@/api/projectQueries';
import {
  useSearchHubUser,
  useSendFriendRequest,
  useAcceptFriendRequest,
  useRejectFriendRequest,
  useRemoveContact,
  useBlockContact,
  useUnblockContact,
  useUpdateContactRemark,
  useCreateGroupSession,
  useListFriendRequests,
} from '@/api/contactQueries';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import {
  resolveWebWorkbenchConversations,
  readStoredWebActiveAgentTask,
  webActiveAgentTaskQueryKey,
  webConversationWithPinnedMessages,
} from './webPlatform';
import { useWebHubRealtime } from './webHubRealtime';
import { decideWebApprovalWithHubClient } from './webWorkbenchApprovals';
import {
  appendHubRuntimeEvent,
  mergeHubRuntimeEvents,
  mergeHubTaskContractEvents,
} from './webWorkbenchRuntimeEvents';
import {
  executionTargetLabel,
  resolveWebExecutionTargetStatus,
} from './webWorkbenchExecutionTargets';
import {
  mergeWorkspaceProjectDetail,
  projectDraftToHubRequest,
  resolveWebProjectsStatus,
  resolveWebWorkbenchProjects,
  workspaceProjectToProjectInfo,
} from './webWorkbenchProjects';
import {
  resolveWebRuntimeEvidence,
  resolveWebTaskContractStatusBlocks,
  resolveWebTranscriptMessages,
  resolveWebWorkbenchTranscript,
} from './webWorkbenchTranscript';
import { errorMessage } from './webWorkbenchError';

const hubClient = createHubClient({ getToken: getAccessToken });

/**
 * Resolve the active Hub session id for transcript queries (#1972).
 *
 * REST `/client/sessions` payloads only carry snake_case `session_id`,
 * while conversation ids are derived as `session.id ?? session.session_id`
 * in webPlatformMapping. The activation gate must use the same derivation —
 * matching on `session.id` alone is always false against real payloads,
 * which leaves the hub-messages/pins/agent-task queries permanently
 * disabled and the transcript stuck on the preview/empty fallback.
 */
export function resolveWebActiveHubSessionId(
  hubReady: boolean,
  sessions: Session[] | undefined,
  activeConversationId: string | undefined,
): string | null {
  if (!hubReady || !activeConversationId) return null;
  const matched = sessions?.some(
    (session) => (session.id ?? session.session_id) === activeConversationId,
  );
  return matched ? activeConversationId : null;
}

export function useWebWorkbenchModel(selectedConversationId?: string, selectedProjectId?: string) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const dataModeOverride = useSyncExternalStore(
    subscribeWorkbenchDataModeOverride,
    getWorkbenchDataModeOverrideSnapshot,
    getWorkbenchDataModeOverrideSnapshot,
  );
  const dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE, dataModeOverride || undefined);
  const dataModeContract = getWorkbenchDataModeContract(dataMode);
  const authenticated = useHubStore((state) => state.authenticated);
  const realMode = dataModeContract.isRealDataMode;
  const hubReady = dataModeContract.allowsHubData && authenticated && Boolean(getAccessToken());
  const queryClient = useQueryClient();
  const [liveRuntimeEvents, setLiveRuntimeEvents] = useState<HubRuntimeEventTranscriptInput[]>([]);

  // Subscribe to agent activity changes for the streaming status bar.
  const agentActivity = useSyncExternalStore(
    getAgentActivityStore().subscribe,
    getAgentActivityStore().getSnapshot,
    getAgentActivityStore().getSnapshot,
  );

  // Subscribe to the session-scoped pinMap store: MESSAGE_PIN/MESSAGE_UNPIN
  // frames (webHubRealtime) and the /pins endpoint seed below feed it, and the
  // normalize pipeline merges `pinned` into HubMessageTranscriptInput from it.
  const pinnedSnapshot = useSyncExternalStore(
    getPinMapStore().subscribe,
    getPinMapStore().getSnapshot,
    getPinMapStore().getSnapshot,
  );

  const sessions = useQuery({
    queryKey: ['web-v4', 'hub-sessions', hubReady],
    queryFn: () => hubClient.listSessions(),
    enabled: hubReady,
    refetchInterval: hubReady ? 10_000 : false,
    placeholderData: (previous) => previous,
  });

  const conversations = useMemo(
    () => resolveWebWorkbenchConversations(sessions.data, hubReady, dataMode),
    [sessions.data, hubReady, dataMode],
  );
  // Prefer explicit selection. Fall back to first conversation only when none selected.
  // Keep a parent-provided id even if it is temporarily absent from the list (#1010).
  const activeConversationId = selectedConversationId
    ?? conversations[0]?.id
    ?? 'agent-collab';
  // Only treat as Hub session when the resolved id is actually a Hub session
  // (id derivation aligned with webPlatformMapping; see resolveWebActiveHubSessionId, #1972).
  const activeHubSessionId = resolveWebActiveHubSessionId(hubReady, sessions.data, activeConversationId);

  useEffect(() => {
    setLiveRuntimeEvents([]);
  }, [activeHubSessionId]);

  const appendLiveRuntimeEvent = useCallback((event: HubRuntimeEventTranscriptInput) => {
    setLiveRuntimeEvents((current) => appendHubRuntimeEvent(current, event));
  }, []);

  const onReplayEvents = useCallback((events: HubRuntimeEventTranscriptInput[]) => {
    if (events.length === 0) return;
    setLiveRuntimeEvents((current) => {
      let merged = current;
      for (const event of events) {
        merged = appendHubRuntimeEvent(merged, event);
      }
      return merged;
    });
  }, []);

  const activeAgentTask = useQuery({
    queryKey: activeHubSessionId
      ? webActiveAgentTaskQueryKey(activeHubSessionId)
      : ['web-v4', 'active-agent-task', 'none'],
    queryFn: () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled gate guarantees the value when the query runs
      return readStoredWebActiveAgentTask(activeHubSessionId!);
    },
    enabled: Boolean(activeHubSessionId),
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: (previous) => previous,
  });
  const activeAgentTaskId = activeAgentTask.data?.taskId;

  useWebHubRealtime({
    enabled: hubReady,
    runtimeSessionId: activeHubSessionId,
    runtimeTaskId: activeAgentTaskId ?? null,
    onRuntimeEvent: appendLiveRuntimeEvent,
    onReplayEvents,
  });

  const messages = useQuery({
    queryKey: ['web-v4', 'hub-messages', activeHubSessionId],
    queryFn: () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled gate guarantees the value when the query runs
      return hubClient.getMessages(activeHubSessionId!, { limit: 80 });
    },
    enabled: Boolean(activeHubSessionId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });

  const replayedRuntimeEvents = useQuery({
    queryKey: ['web-v4', 'agent-task-events', activeAgentTaskId],
    queryFn: () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled gate guarantees the value when the query runs
      return hubClient.listTaskRunEvents(activeAgentTaskId!);
    },
    enabled: Boolean(activeAgentTaskId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });
  const activeAgentTaskSummary = useQuery({
    queryKey: ['web-v4', 'agent-task-summary', activeAgentTaskId],
    queryFn: () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled gate guarantees the value when the query runs
      return hubClient.getTaskRunEventSummary(activeAgentTaskId!);
    },
    enabled: Boolean(activeAgentTaskId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });
  const activeAgentTaskApprovals = useQuery({
    queryKey: ['web-v4', 'agent-task-approvals', activeAgentTaskId],
    queryFn: () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled gate guarantees the value when the query runs
      return hubClient.listTaskApprovals(activeAgentTaskId!);
    },
    enabled: Boolean(activeAgentTaskId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });
  const activeAgentTaskArtifacts = useQuery({
    queryKey: ['web-v4', 'agent-task-artifacts', activeAgentTaskId],
    queryFn: () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled gate guarantees the value when the query runs
      return hubClient.listTaskArtifacts(activeAgentTaskId!);
    },
    enabled: Boolean(activeAgentTaskId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });

  const pinnedMessages = useQuery({
    queryKey: ['web-v4', 'hub-pins', activeHubSessionId],
    queryFn: () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled gate guarantees the value when the query runs
      return hubClient.listPinnedMessages(activeHubSessionId!);
    },
    enabled: Boolean(activeHubSessionId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });

  // Seed the pinMap store from GET /client/sessions/{id}/pins. The pins
  // query is keyed per session, so data changes on session switch (and after
  // pin/unpin invalidations) — each arrival re-seeds the session bucket.
  // placeholderData guard: during a session switch the query briefly shows the
  // previous session's pins, which must not seed the new session's bucket.
  useEffect(() => {
    if (activeHubSessionId && !pinnedMessages.isPlaceholderData && pinnedMessages.data) {
      getPinMapStore().loadPinnedForSession(
        activeHubSessionId,
        pinnedMessages.data.map((message) => message.id),
      );
    } else if (!activeHubSessionId) {
      // Signed out / no Hub session: drop the session pointer so stale
      // frames can never leak into a later session.
      getPinMapStore().setActiveSession(null);
    }
  }, [activeHubSessionId, pinnedMessages.data, pinnedMessages.isPlaceholderData]);

  const contacts = useQuery({
    queryKey: ['web-v4', 'hub-contacts', hubReady],
    queryFn: () => hubClient.listContacts(),
    enabled: hubReady,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });

  const projects = useHubWorkspaceProjects({ enabled: hubReady, getToken: getAccessToken });
  const selectedProjectDetailId = hubReady
    ? selectedProjectId ?? projects.data?.items[0]?.id
    : undefined;
  const selectedProject = useHubWorkspaceProject({
    projectId: selectedProjectDetailId,
    enabled: Boolean(selectedProjectDetailId),
    getToken: getAccessToken,
  });
  const selectedProjectThreads = useHubWorkspaceProjectThreads({
    projectId: selectedProjectDetailId,
    enabled: hubReady && Boolean(selectedProjectDetailId),
    getToken: getAccessToken,
  });
  const selectedProjectThreadId = selectedProjectThreads.data?.[0]?.id;
  const selectedProjectThreadMessages = useHubWorkspaceProjectThreadMessages({
    projectId: selectedProjectDetailId,
    threadId: selectedProjectThreadId,
    enabled: hubReady && Boolean(selectedProjectDetailId) && Boolean(selectedProjectThreadId),
    getToken: getAccessToken,
  });
  const createProject = useCreateHubWorkspaceProject({ getToken: getAccessToken });
  const updateProject = useUpdateHubWorkspaceProject({ getToken: getAccessToken });
  const decideApproval = useMutation({
    mutationFn: (action: ApprovalDecisionAction) => decideWebApprovalWithHubClient(hubClient, action),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-teams'] });
      if (activeAgentTaskId) {
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'agent-task-events', activeAgentTaskId] });
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'agent-task-summary', activeAgentTaskId] });
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'agent-task-approvals', activeAgentTaskId] });
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'agent-task-artifacts', activeAgentTaskId] });
      }
    },
  });

  // Contact mutation hooks (Hub)
  const searchUser = useSearchHubUser();
  const sendFriendRequest = useSendFriendRequest();
  useListFriendRequests({ enabled: hubReady });
  const acceptFriendRequest = useAcceptFriendRequest();
  const rejectFriendRequest = useRejectFriendRequest();
  const removeContact = useRemoveContact();
  const blockContact = useBlockContact();
  const unblockContact = useUnblockContact();
  const updateContactRemark = useUpdateContactRemark();
  const createGroupSession = useCreateGroupSession();

  // ── Chat action mutations ──────────────────────────────────────────

  const recallMessageMut = useMutation({
    mutationFn: (messageId: string) => hubClient.recallMessage(messageId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages', activeHubSessionId] });
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-sessions'] });
    },
  });

  const editMessageMut = useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) =>
      hubClient.editMessage(messageId, { content }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages', activeHubSessionId] });
    },
  });

  // Cancel the active agent task (#1462 CF13). The Hub broadcasts an
  // `agent.cancel` WS frame on success; the realtime layer then clears the
  // agent-activity store and flips the task status to `cancelled`, so we only
  // need to fire the REST here and refresh the task caches on settle.
  const cancelAgentTaskMut = useMutation({
    mutationFn: (taskId: string) => hubClient.cancelAgentTask(taskId),
    onSettled: () => {
      if (activeHubSessionId) {
        void queryClient.invalidateQueries({ queryKey: webActiveAgentTaskQueryKey(activeHubSessionId) });
      }
      if (activeAgentTaskId) {
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'agent-task-events', activeAgentTaskId] });
        void queryClient.invalidateQueries({ queryKey: ['web-v4', 'agent-task-summary', activeAgentTaskId] });
      }
    },
  });

  const pinMessageMut = useMutation({
    mutationFn: ({ messageId, sessionId }: { messageId: string; sessionId: string }) =>
      hubClient.pinMessage(messageId, sessionId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-pins', activeHubSessionId] });
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages', activeHubSessionId] });
    },
  });

  const unpinMessageMut = useMutation({
    mutationFn: ({ messageId, sessionId }: { messageId: string; sessionId: string }) =>
      hubClient.unpinMessage(messageId, sessionId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-pins', activeHubSessionId] });
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages', activeHubSessionId] });
    },
  });

  const forwardMessageMut = useMutation({
    mutationFn: ({ messageId, targetSessionIds }: { messageId: string; targetSessionIds: string[] }) =>
      hubClient.forwardMessage(messageId, targetSessionIds),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-sessions'] });
    },
  });

  const searchMessagesMut = useMutation({
    mutationFn: (params: { q: string; session_id?: string; content_type?: string; from?: string; to?: string }) =>
      hubClient.searchMessages(params),
  });

  const searchSessionMessagesMut = useMutation({
    mutationFn: ({ sessionId, params }: {
      sessionId: string;
      params: { q: string; content_type?: string; from?: string; to?: string };
    }) => hubClient.searchSessionMessages(sessionId, params),
  });

  const markReadMut = useMutation({
    mutationFn: ({ sessionId, lastReadSeq }: { sessionId: string; lastReadSeq: number }) =>
      hubClient.markRead(sessionId, lastReadSeq),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-sessions'] });
    },
  });

  const addReactionMut = useMutation({
    mutationFn: ({ messageId, sessionId, emoji }: { messageId: string; sessionId: string; emoji: string }) =>
      hubClient.addMessageReaction(messageId, sessionId, { emoji }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages', activeHubSessionId] });
    },
  });

  const removeReactionMut = useMutation({
    mutationFn: ({ messageId, sessionId, emoji }: { messageId: string; sessionId: string; emoji: string }) =>
      hubClient.removeMessageReaction(messageId, sessionId, { emoji }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-messages', activeHubSessionId] });
    },
  });

  // Auto mark-as-read when user opens a session (#1352). The messages query
  // keeps the previous session's rows visible through placeholderData during a
  // session switch, so the derived seq is null until the loaded data actually
  // belongs to activeHubSessionId — no cross-session markRead with a stale
  // seq — and re-fires once the session's own messages arrive or grow.
  useWebSessionAutoMarkRead(
    hubReady,
    activeHubSessionId,
    resolveWebSessionLastReadSeq(messages.isPlaceholderData, messages.data),
    markReadMut.mutate,
  );

  const executionTargets = useHubExecutionTargets({ enabled: hubReady });
  const onlineLocalEdgeTargets = useMemo(
    () => (executionTargets.data?.items ?? []).filter((target) =>
      target.target_type === 'local_edge' &&
      target.is_online === true &&
      (target.health_state === 'online' || target.health_state === 'healthy')
    ),
    [executionTargets.data],
  );
  const composerExecutionTargets = useMemo(
    () => hubReady || realMode
      ? onlineLocalEdgeTargets.map((target) => {
          const id = String(target.id ?? '');
          const name = target.name ? String(target.name) : '';
          return {
            id,
            label: name ? `${name} (${id})` : id,
            // Already filtered to online + healthy above; the explicit marker
            // lets session-chrome default selection trust the entry (#1819).
            healthy: true,
          };
        })
      : undefined,
    [hubReady, realMode, onlineLocalEdgeTargets],
  );
  const executionTargetStatus = useMemo(
    () => resolveWebExecutionTargetStatus({
      hubReady,
      dataMode,
      isFetching: executionTargets.isFetching,
      error: executionTargets.error,
      targets: executionTargets.data?.items,
    }),
    [hubReady, dataMode, executionTargets.isFetching, executionTargets.error, executionTargets.data],
  );

  // ── Devices / execution-target management page (#1819) ─────────────
  // Full registered inventory (not the healthy-only composer filter) with
  // health detail; ping reuses the existing Hub mutation.
  const devicesTargets = useMemo(
    () => hubReady || realMode
      ? (executionTargets.data?.items ?? []).map(mapWebExecutionTargetToDeviceEntry)
      : undefined,
    [hubReady, realMode, executionTargets.data],
  );
  const pingExecutionTarget = usePingHubExecutionTarget();
  const handleDevicePing = useCallback((targetId: string) => {
    pingExecutionTarget.mutate(targetId, {
      onSuccess: () => {
        useToastStore.getState().showToast('success', t('devices.pingOk'));
      },
      onError: (err) => {
        useToastStore.getState().showToast(
          'error',
          t('devices.pingFailed', { detail: err instanceof Error ? err.message : String(err) }),
        );
      },
    });
  }, [pingExecutionTarget, t]);

  // ── Token usage board (#1819) ──────────────────────────────────────
  const usageBoard = useTokenUsageBoard(hubReady);
  const usageTeams = useMemo(
    () => (hubReady || realMode ? usageBoard.data ?? [] : undefined),
    [hubReady, realMode, usageBoard.data],
  );

  // Transcript normalization pipeline (#1352): every step below is pure and
  // recomputed over the full message/event lists, so memoize each step on its
  // actual inputs to avoid full recomputation on unrelated high-frequency
  // re-renders (e.g. per-token agent activity updates while streaming).
  const resolvedConversations = useMemo(
    () => (hubReady && activeHubSessionId
      ? conversations.map((conversation) =>
        conversation.id === activeHubSessionId
          ? webConversationWithPinnedMessages(conversation, pinnedMessages.data)
          : conversation,
      )
      : conversations),
    [hubReady, activeHubSessionId, conversations, pinnedMessages.data],
  );

  const mergedRuntimeEvents = useMemo(
    () => mergeHubTaskContractEvents(
      mergeHubRuntimeEvents(replayedRuntimeEvents.data, liveRuntimeEvents),
      activeAgentTaskApprovals.data,
      activeAgentTaskArtifacts.data,
    ),
    [replayedRuntimeEvents.data, liveRuntimeEvents, activeAgentTaskApprovals.data, activeAgentTaskArtifacts.data],
  );
  const transcript = useMemo(
    () => resolveWebWorkbenchTranscript(
      hubReady,
      activeHubSessionId,
      // Merge the pinMap store's pinned state into the normalize input:
      // hub messages carry no pin field, so the store (fed by WS frames and
      // seeded from /pins) is the only normalize-time source.
      // #1821: while the messages query shows placeholderData the rows still
      // belong to the previous session — never surface them as the new
      // session's transcript (session-switch old-message flash).
      withPinnedState(
        resolveWebTranscriptMessages(messages.isPlaceholderData, messages.data),
        pinnedSnapshot.pinnedIds,
      ),
      mergedRuntimeEvents,
      dataMode,
      selectedConversationId,
      t,
    ),
    [hubReady, activeHubSessionId, messages.data, messages.isPlaceholderData, pinnedSnapshot, mergedRuntimeEvents, dataMode, selectedConversationId, t],
  );
  const taskContractStatusBlocks = useMemo(
    () => resolveWebTaskContractStatusBlocks(
      activeAgentTaskId,
      activeAgentTaskApprovals.error,
      activeAgentTaskArtifacts.error,
    ),
    [activeAgentTaskId, activeAgentTaskApprovals.error, activeAgentTaskArtifacts.error],
  );
  const surfacedTranscript = useMemo(
    () => (executionTargetStatus.block
      ? [executionTargetStatus.block, ...taskContractStatusBlocks, ...transcript]
      : [...taskContractStatusBlocks, ...transcript]),
    [executionTargetStatus.block, taskContractStatusBlocks, transcript],
  );
  const runtimeEvidence = useMemo(
    () => resolveWebRuntimeEvidence(surfacedTranscript),
    [surfacedTranscript],
  );

  // An agent run is "active" while any tracked agent is dispatching / thinking
  // / streaming, or the recorded task status is still `running` (#1462 CF13).
  // The agent-activity store is the live signal (fed by WS events); the task
  // status covers the brief window before the first activity event lands.
  const isAgentRunning =
    agentActivity.activeAgents.some(
      (agent) =>
        agent.status === 'dispatching' ||
        agent.status === 'thinking' ||
        agent.status === 'streaming',
    ) || activeAgentTask.data?.status === 'running';

  const onCancelRun = useCallback(() => {
    const taskId = activeAgentTask.data?.taskId;
    if (!taskId) return;
    // #1821: a failed cancel must be visible — surface the error toast
    // instead of swallowing the rejection.
    void cancelAgentTaskMut.mutateAsync(taskId).catch((error: unknown) => {
      useToastStore.getState().showToast(
        'error',
        error instanceof Error && error.message ? error.message : t('toast.cancelFailed'),
      );
    });
  }, [activeAgentTask.data?.taskId, cancelAgentTaskMut, t]);

  const workbenchStatus = useMemo(
    () => ({
      dataMode: dataModeContract.statusLabel,
      targetState: executionTargetStatus.state,
      targetLabel: executionTargetStatus.selectedTarget
        ? executionTargetLabel(executionTargetStatus.selectedTarget)
        : undefined,
      initialLoading: hubReady
        && (sessions.isLoading || (Boolean(activeHubSessionId) && messages.isLoading))
        && conversations.length === 0
        && !sessions.error
        && !messages.error,
      ...(sessions.error || messages.error
        ? {
            loadError: errorMessage(
              sessions.error ?? messages.error,
              'Hub chat load failed',
            ),
          }
        : {}),
      replayLabel: activeHubSessionId
        ? activeAgentTaskId
          ? `Hub replay: task ${activeAgentTaskId} · ${activeAgentTaskSummary.data?.total_events ?? mergedRuntimeEvents.length} runtime event${(activeAgentTaskSummary.data?.total_events ?? mergedRuntimeEvents.length) === 1 ? '' : 's'} observed`
          : `Hub replay: ${liveRuntimeEvents.length} runtime event${liveRuntimeEvents.length === 1 ? '' : 's'} observed`
        : realMode
          ? 'Hub replay: no active Hub session'
          : 'Fixture replay: shared demo transcript',
    }),
    [
      dataModeContract,
      executionTargetStatus,
      hubReady,
      realMode,
      sessions.isLoading,
      sessions.error,
      messages.isLoading,
      messages.error,
      conversations,
      activeHubSessionId,
      activeAgentTaskId,
      activeAgentTaskSummary.data,
      mergedRuntimeEvents,
      liveRuntimeEvents,
    ],
  );

  return {
    activeConversationId,
    isAgentRunning,
    onCancelRun,
    // #1821: while a Hub session's messages are still loading (or the switch
    // is showing placeholder rows the transcript hides), the shell renders an
    // honest loading state instead of "no messages" (#5 session-switch item).
    transcriptLoading: Boolean(activeHubSessionId) && (messages.isPlaceholderData || messages.isLoading),
    contacts: resolveHubContacts(contacts.data as HubContactLike[] | undefined, hubReady, dataMode),
    contactsActions: hubReady ? {
      onSearchUser: (query: string) => searchUser.mutateAsync(query),
      onSendFriendRequest: (userId: string, message?: string) => sendFriendRequest.mutateAsync({ userId, ...(message != null ? { message } : {}) }),
      onAcceptRequest: (requestId: string) => acceptFriendRequest.mutateAsync(requestId),
      onRejectRequest: (requestId: string) => rejectFriendRequest.mutateAsync(requestId),
      onRemoveContact: (userId: string) => removeContact.mutateAsync(userId),
      onBlockContact: (userId: string) => blockContact.mutateAsync(userId),
      onUnblockContact: (userId: string) => unblockContact.mutateAsync(userId),
      onUpdateRemark: (userId: string, remark: string) => updateContactRemark.mutateAsync({ userId, remark }),
      onCreateGroup: (name: string, memberIds: string[]) => createGroupSession.mutateAsync({ name, memberIds }),
    } : undefined,
    chatActions: hubReady ? {
      onRecallMessage: (messageId: string) => recallMessageMut.mutateAsync(messageId),
      onEditMessage: (messageId: string, content: string) => editMessageMut.mutateAsync({ messageId, content }),
      onPinMessage: (messageId: string, sessionId: string) => pinMessageMut.mutateAsync({ messageId, sessionId }),
      onUnpinMessage: (messageId: string, sessionId: string) => unpinMessageMut.mutateAsync({ messageId, sessionId }),
      onForwardMessage: (messageId: string, targetSessionIds: string[]) => forwardMessageMut.mutateAsync({ messageId, targetSessionIds }),
      onSearchMessages: (params: { q: string; session_id?: string; content_type?: string; from?: string; to?: string }) => searchMessagesMut.mutateAsync(params),
      onSearchSessionMessages: (sessionId: string, params: { q: string; content_type?: string; from?: string; to?: string }) => searchSessionMessagesMut.mutateAsync({ sessionId, params }),
      onMarkRead: (sessionId: string, lastReadSeq: number) => markReadMut.mutateAsync({ sessionId, lastReadSeq }),
      onAddReaction: (messageId: string, sessionId: string, emoji: string) => addReactionMut.mutateAsync({ messageId, sessionId, emoji }),
      onRemoveReaction: (messageId: string, sessionId: string, emoji: string) => removeReactionMut.mutateAsync({ messageId, sessionId, emoji }),
    } : undefined,
    conversations: resolvedConversations,
    composerExecutionTargets,
    // Devices / execution-target management page (#1819)
    devicesTargets,
    devicesLoading: executionTargets.isFetching && !executionTargets.data,
    devicesError: executionTargets.error
      ? (executionTargets.error instanceof Error ? executionTargets.error.message : String(executionTargets.error))
      : null,
    onDevicesRetry: () => { void executionTargets.refetch(); },
    devicesPingingId: pingExecutionTarget.isPending ? (pingExecutionTarget.variables ?? null) : null,
    onDevicePing: handleDevicePing,
    // Token usage board (#1819)
    usageTeams,
    usageLoading: usageBoard.isFetching && !usageBoard.data,
    usageError: usageBoard.error
      ? (usageBoard.error instanceof Error ? usageBoard.error.message : String(usageBoard.error))
      : null,
    onUsageRetry: () => { void usageBoard.refetch(); },
    projects: resolveWebWorkbenchProjects(
      mergeWorkspaceProjectDetail(projects.data?.items, selectedProject.data),
      hubReady,
      dataMode,
      selectedProjectDetailId
        ? {
            [selectedProjectDetailId]: {
              threads: selectedProjectThreads.data ?? [],
              messages: selectedProjectThreadMessages.data ?? [],
            },
          }
        : undefined,
    ),
    projectsStatus: resolveWebProjectsStatus(
      { isFetching: projects.isFetching, error: projects.error },
      createProject.error,
      updateProject.error,
      hubReady,
      dataMode,
      createProject.isPending || updateProject.isPending,
      { isFetching: selectedProject.isFetching, error: selectedProject.error },
      {
        isFetching: selectedProjectThreads.isFetching || selectedProjectThreadMessages.isFetching,
        error: selectedProjectThreads.error ?? selectedProjectThreadMessages.error,
      },
    ),
    projectsActions: hubReady ? {
      create: async (draft: ProjectDraft) => (
        workspaceProjectToProjectInfo(await createProject.mutateAsync(projectDraftToHubRequest(draft)))
      ),
      update: async (projectId: string, draft: ProjectDraft) => (
        workspaceProjectToProjectInfo(await updateProject.mutateAsync({
          projectId,
          draft: projectDraftToHubRequest(draft),
        }))
      ),
    } : undefined,
    onApprovalDecision: hubReady
      ? (action: ApprovalDecisionAction) => decideApproval.mutateAsync(action)
      : undefined,
    runtimeEvidence,
    workbenchStatus,
    transcript: surfacedTranscript,
    agentActivity,
  };
}

/**
 * Derive the seq to auto mark-as-read for the active session (#1352).
 * Returns null while the messages query is showing placeholderData — during a
 * session switch that data still belongs to the previous session, so a stale
 * seq must never be written to the new session.
 */
export function resolveWebSessionLastReadSeq(
  isPlaceholderData: boolean,
  messages: ReadonlyArray<{ seq_id?: number | null }> | undefined,
): number | null {
  if (isPlaceholderData || !messages || messages.length === 0) return null;
  return messages[messages.length - 1]?.seq_id ?? null;
}

/**
 * Fire markRead once a session's own messages are visible, and again whenever
 * a newer seq arrives (#1352). markRead is kept in a ref because the
 * react-query mutation result object is recreated on every render — putting it
 * in the effect deps would loop, and freezing the first closure could go stale.
 */
export function useWebSessionAutoMarkRead(
  hubReady: boolean,
  sessionId: string | null,
  lastReadSeq: number | null,
  markRead: (input: { sessionId: string; lastReadSeq: number }) => void,
): void {
  const markReadRef = useRef(markRead);
  useEffect(() => {
    markReadRef.current = markRead;
  }, [markRead]);

  useEffect(() => {
    if (!hubReady || !sessionId || lastReadSeq == null) return;
    markReadRef.current({ sessionId, lastReadSeq });
  }, [hubReady, sessionId, lastReadSeq]);
}

/**
 * Map a Hub execution-target inventory row to the Devices page entry (#1819).
 * Only forwards fields the Hub actually returned (exactOptionalPropertyTypes).
 */
export function mapWebExecutionTargetToDeviceEntry(
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

// Stable public re-exports (tests + external consumers)
export { decideWebApprovalWithHubClient } from './webWorkbenchApprovals';
export {
  appendHubRuntimeEvent,
  mergeHubRuntimeEvents,
  mergeHubTaskContractEvents,
} from './webWorkbenchRuntimeEvents';
export {
  resolveWebRuntimeEvidence,
  resolveWebTranscriptMessages,
  resolveWebWorkbenchTranscript,
} from './webWorkbenchTranscript';
export {
  mergeWorkspaceProjectDetail,
  parseWorkspaceProjectThreadMessageContent,
  projectDraftToHubRequest,
  resolveWebProjectsStatus,
  resolveWebWorkbenchProjects,
  workspaceProjectToProjectInfo,
  type ParsedProjectThreadMessageContent,
  type WorkspaceProjectGroupProjection,
} from './webWorkbenchProjects';
export {
  resolveWebExecutionTargetStatus,
  type WebExecutionTargetStatus,
  type WebExecutionTargetStatusState,
} from './webWorkbenchExecutionTargets';
export { hubEmptyContacts as webHubEmptyContacts } from '@agenthub/workbench/hubDataMapping';
export { contactInfoToMember } from '@agenthub/workbench/hubDataMapping';
export { resolveHubContacts as resolveWebWorkbenchContacts } from '@agenthub/workbench/hubDataMapping';
