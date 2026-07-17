import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectDraft } from '@shared/workbench';
import {
  getWorkbenchDataModeContract,
  getWorkbenchDataModeOverrideSnapshot,
  resolveWorkbenchDataMode,
  subscribeWorkbenchDataModeOverride,
} from '@shared/demo';
import {
  resolveHubContacts,
  type HubContactLike,
} from '@shared/workbench/hubDataMapping';
import {
  getAgentActivityStore,
  type ApprovalDecisionAction,
  type HubRuntimeEventTranscriptInput,
} from '@shared/transcript';
import { createHubClient } from '@/api/hubClient';
import { useHubExecutionTargets } from '@/api/executionTargetQueries';
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
  resolveWebWorkbenchTranscript,
} from './webWorkbenchTranscript';

const hubClient = createHubClient({ getToken: getAccessToken });

export function useWebWorkbenchModel(selectedConversationId?: string, selectedProjectId?: string) {
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

  const sessions = useQuery({
    queryKey: ['web-v4', 'hub-sessions', hubReady],
    queryFn: () => hubClient.listSessions(),
    enabled: hubReady,
    refetchInterval: hubReady ? 10_000 : false,
    placeholderData: (previous) => previous,
  });

  const conversations = resolveWebWorkbenchConversations(sessions.data, hubReady, dataMode);
  const activeConversationId = (
    conversations.some((conversation) => conversation.id === selectedConversationId)
      ? selectedConversationId
      : conversations[0]?.id
  ) ?? 'agent-collab';
  const activeHubSessionId = hubReady && sessions.data?.length ? activeConversationId : null;

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
    queryFn: () => readStoredWebActiveAgentTask(activeHubSessionId!),
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
    queryFn: () => hubClient.getMessages(activeHubSessionId!, { limit: 80 }),
    enabled: Boolean(activeHubSessionId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });

  const replayedRuntimeEvents = useQuery({
    queryKey: ['web-v4', 'agent-task-events', activeAgentTaskId],
    queryFn: () => hubClient.listTaskRunEvents(activeAgentTaskId!),
    enabled: Boolean(activeAgentTaskId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });
  const activeAgentTaskSummary = useQuery({
    queryKey: ['web-v4', 'agent-task-summary', activeAgentTaskId],
    queryFn: () => hubClient.getTaskRunEventSummary(activeAgentTaskId!),
    enabled: Boolean(activeAgentTaskId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });
  const activeAgentTaskApprovals = useQuery({
    queryKey: ['web-v4', 'agent-task-approvals', activeAgentTaskId],
    queryFn: () => hubClient.listTaskApprovals(activeAgentTaskId!),
    enabled: Boolean(activeAgentTaskId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });
  const activeAgentTaskArtifacts = useQuery({
    queryKey: ['web-v4', 'agent-task-artifacts', activeAgentTaskId],
    queryFn: () => hubClient.listTaskArtifacts(activeAgentTaskId!),
    enabled: Boolean(activeAgentTaskId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });

  const pinnedMessages = useQuery({
    queryKey: ['web-v4', 'hub-pins', activeHubSessionId],
    queryFn: () => hubClient.listPinnedMessages(activeHubSessionId!),
    enabled: Boolean(activeHubSessionId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });

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

  // Auto mark-as-read when user opens a session
  useEffect(() => {
    if (!hubReady || !activeHubSessionId) return;
    const currentMessages = messages.data;
    if (!currentMessages || currentMessages.length === 0) return;
    const lastSeq = currentMessages[currentMessages.length - 1]?.seq_id;
    if (lastSeq == null) return;
    markReadMut.mutate({ sessionId: activeHubSessionId, lastReadSeq: lastSeq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubReady, activeHubSessionId]);

  const executionTargets = useHubExecutionTargets({ enabled: hubReady });
  const onlineLocalEdgeTargets = (executionTargets.data?.items ?? []).filter((target) =>
    target.target_type === 'local_edge' &&
    target.is_online === true &&
    (target.health_state === 'online' || target.health_state === 'healthy')
  );
  const composerExecutionTargets = hubReady || realMode
    ? onlineLocalEdgeTargets.map((target) => {
        const id = String(target.id ?? '');
        const name = target.name ? String(target.name) : '';
        return {
          id,
          label: name ? `${name} (${id})` : id,
        };
      })
    : undefined;
  const executionTargetStatus = resolveWebExecutionTargetStatus({
    hubReady,
    dataMode,
    isFetching: executionTargets.isFetching,
    error: executionTargets.error,
    targets: executionTargets.data?.items,
  });

  const resolvedConversations = hubReady && activeHubSessionId
    ? conversations.map((conversation) =>
      conversation.id === activeHubSessionId
        ? webConversationWithPinnedMessages(conversation, pinnedMessages.data)
        : conversation,
    )
    : conversations;

  const mergedRuntimeEvents = mergeHubTaskContractEvents(
    mergeHubRuntimeEvents(replayedRuntimeEvents.data, liveRuntimeEvents),
    activeAgentTaskApprovals.data,
    activeAgentTaskArtifacts.data,
  );
  const transcript = resolveWebWorkbenchTranscript(
    hubReady,
    activeHubSessionId,
    messages.data,
    mergedRuntimeEvents,
    dataMode,
    selectedConversationId,
  );
  const taskContractStatusBlocks = resolveWebTaskContractStatusBlocks(
    activeAgentTaskId,
    activeAgentTaskApprovals.error,
    activeAgentTaskArtifacts.error,
  );
  const surfacedTranscript = executionTargetStatus.block
    ? [executionTargetStatus.block, ...taskContractStatusBlocks, ...transcript]
    : [...taskContractStatusBlocks, ...transcript];

  return {
    activeConversationId,
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
    runtimeEvidence: resolveWebRuntimeEvidence(surfacedTranscript),
    workbenchStatus: {
      dataMode: dataModeContract.statusLabel,
      targetState: executionTargetStatus.state,
      targetLabel: executionTargetStatus.selectedTarget
        ? executionTargetLabel(executionTargetStatus.selectedTarget)
        : undefined,
      replayLabel: activeHubSessionId
        ? activeAgentTaskId
          ? `Hub replay: task ${activeAgentTaskId} · ${activeAgentTaskSummary.data?.total_events ?? mergedRuntimeEvents.length} runtime event${(activeAgentTaskSummary.data?.total_events ?? mergedRuntimeEvents.length) === 1 ? '' : 's'} observed`
          : `Hub replay: ${liveRuntimeEvents.length} runtime event${liveRuntimeEvents.length === 1 ? '' : 's'} observed`
        : realMode
          ? 'Hub replay: no active Hub session'
          : 'Fixture replay: shared demo transcript',
    },
    transcript: surfacedTranscript,
    agentActivity,
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
export { hubEmptyContacts as webHubEmptyContacts } from '@shared/workbench/hubDataMapping';
export { contactInfoToMember } from '@shared/workbench/hubDataMapping';
export { resolveHubContacts as resolveWebWorkbenchContacts } from '@shared/workbench/hubDataMapping';
