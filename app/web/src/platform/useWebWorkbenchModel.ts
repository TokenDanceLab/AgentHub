import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectDraft, ProjectInfo, RuntimeEvidenceSnapshot } from '@shared/workbench';
import type { WorkbenchDataMode } from '@shared/demo';
import {
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  getWorkbenchDataModeOverrideSnapshot,
  isWorkbenchFixtureDataMode,
  isWorkbenchRealDataMode,
  resolveWorkbenchDataMode,
  resolveDemoWorkbenchTranscript,
  subscribeWorkbenchDataModeOverride,
  workbenchDataModeLabel,
} from '@shared/demo';
import {
  contactInfoToMember,
  hubEmptyContacts,
  resolveHubContacts,
  type HubContactLike,
} from '@shared/workbench/hubDataMapping';
import {
  normalizeHubMessagesToTranscript,
  normalizeHubRuntimeEventsToTranscript,
  collectTranscriptEvidence,
  resolveCurrentTranscriptRunId,
  getAgentActivityStore,
  type ApprovalDecisionAction,
  type HubMessageTranscriptInput,
  type HubRuntimeEventTranscriptInput,
  type TranscriptBlock,
} from '@shared/transcript';
import type { FileDiff } from '@shared/types/chat';
import { createHubClient } from '@/api/hubClient';
import type {
  AgentTaskApproval,
  AgentTaskApprovalList,
  AgentTaskArtifact,
  AgentTaskArtifactList,
  WorkspaceProject,
  WorkspaceProjectThread,
  WorkspaceProjectThreadMessage,
} from '@/api/hubClient';
import { useHubExecutionTargets } from '@/api/executionTargetQueries';
import type { ExecutionTargetInventoryItem } from '@/api/executionTargetQueries';
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
  webHubEmptyTranscript,
} from './webPlatform';
import { useWebHubRealtime } from './webHubRealtime';

const hubClient = createHubClient({ getToken: getAccessToken });

export function useWebWorkbenchModel(selectedConversationId?: string, selectedProjectId?: string) {
  const dataModeOverride = useSyncExternalStore(
    subscribeWorkbenchDataModeOverride,
    getWorkbenchDataModeOverrideSnapshot,
    getWorkbenchDataModeOverrideSnapshot,
  );
  const dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE, dataModeOverride || undefined);
  const authenticated = useHubStore((state) => state.authenticated);
  const fixtureMode = isWorkbenchFixtureDataMode(dataMode);
  const realMode = isWorkbenchRealDataMode(dataMode);
  const hubReady = !fixtureMode && authenticated && Boolean(getAccessToken());
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
  const friendRequests = useListFriendRequests({ enabled: hubReady });
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
    ? onlineLocalEdgeTargets.map((target) => ({
        id: target.id,
        label: target.name ? `${target.name} (${target.id})` : target.id,
      }))
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
      dataMode: workbenchDataModeLabel(dataMode),
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

type WebApprovalHubClient = Pick<ReturnType<typeof createHubClient>, 'decideTaskApproval' | 'decideTeamApproval'>;

export async function decideWebApprovalWithHubClient(
  client: WebApprovalHubClient,
  action: ApprovalDecisionAction,
): Promise<void> {
  if (action.teamId && action.teamRunId) {
    await client.decideTeamApproval(action.teamId, action.teamRunId, action.approvalId, {
      decision: action.decision,
    });
    return;
  }
  if (action.agentTaskId) {
    await client.decideTaskApproval(action.agentTaskId, action.approvalId, {
      decision: action.decision,
    });
    return;
  }
  throw new Error('Hub approval decision requires agentTaskId or teamId and teamRunId');
}

export function mergeHubTaskContractEvents(
  runtimeEvents: HubRuntimeEventTranscriptInput[],
  approvals: AgentTaskApprovalList | undefined,
  artifacts: AgentTaskArtifactList | undefined,
): HubRuntimeEventTranscriptInput[] {
  let merged = runtimeEvents;
  if (approvals) {
    for (const approval of approvals.approvals) {
      merged = appendHubRuntimeEvent(merged, taskApprovalToRuntimeEvent(approval, approvals), 400);
    }
  }
  if (artifacts) {
    for (const artifact of artifacts.artifacts) {
      merged = appendHubRuntimeEvent(merged, taskArtifactToRuntimeEvent(artifact, artifacts), 400);
    }
  }
  return merged;
}

function taskApprovalToRuntimeEvent(
  approval: AgentTaskApproval,
  list: AgentTaskApprovalList,
): HubRuntimeEventTranscriptInput {
  const status = normalizedStatus(approval.status);
  const decided = status && !['pending', 'requested', 'running'].includes(status);
  const toolName = approval.tool_name || 'permission';
  return {
    id: approval.source_event_id || approval.approval_id,
    task_id: approval.task_id || list.task_id,
    ...(approval.edge_run_id || list.edge_run_id ? { edge_run_id: approval.edge_run_id || list.edge_run_id } : {}),
    ...(approval.session_id || list.session_id ? { session_id: approval.session_id || list.session_id } : {}),
    ...(approval.event_seq != null ? { event_seq: approval.event_seq } : {}),
    event_type: decided ? 'run.agent.permission_decided' : 'run.agent.permission_requested',
    payload: {
      approvalId: approval.approval_id,
      requestId: approval.request_id || approval.approval_id,
      toolName,
      ...(approval.tool_use_id ? { toolUseId: approval.tool_use_id } : {}),
      ...(approval.status ? { status: approval.status } : {}),
      ...(approval.reason ? { reason: approval.reason } : {}),
      ...(decided ? { decision: taskApprovalDecision(status) } : {}),
      ...(approval.decided_by ? { decidedBy: approval.decided_by } : {}),
      agent_task_id: approval.task_id || list.task_id,
      ...(approval.edge_run_id || list.edge_run_id ? { edge_run_id: approval.edge_run_id || list.edge_run_id } : {}),
    },
    ...(approval.created_at || approval.decided_at ? { created_at: approval.created_at || approval.decided_at } : {}),
  };
}

function taskArtifactToRuntimeEvent(
  artifact: AgentTaskArtifact,
  list: AgentTaskArtifactList,
): HubRuntimeEventTranscriptInput {
  const artifactId = artifact.artifact_id || artifact.source_event_id || artifact.path || artifact.name || 'artifact';
  const patch = artifact.diff || artifact.patch;
  const artifactKind = artifact.type || artifact.kind || artifact.status;
  const eventType = isTaskFileChangeArtifact(artifact) ? 'run.agent.file_change' : 'artifact.created';
  return {
    id: artifact.source_event_id || artifactId,
    task_id: artifact.task_id || list.task_id,
    ...(artifact.edge_run_id || list.edge_run_id ? { edge_run_id: artifact.edge_run_id || list.edge_run_id } : {}),
    ...(artifact.session_id || list.session_id ? { session_id: artifact.session_id || list.session_id } : {}),
    ...(artifact.event_seq != null ? { event_seq: artifact.event_seq } : {}),
    event_type: eventType,
    payload: {
      artifactId,
      ...(artifact.path || artifact.name ? { path: artifact.path || artifact.name } : {}),
      ...(artifact.name || artifact.path ? { title: artifact.name || artifact.path } : {}),
      ...(artifact.action ? { action: artifact.action } : {}),
      kind: artifactKind || artifact.action || 'artifact',
      ...(artifact.tool_name ? { toolName: artifact.tool_name } : {}),
      ...(artifact.mime_type ? { mimeType: artifact.mime_type } : {}),
      ...(artifact.size_bytes != null ? { sizeBytes: artifact.size_bytes } : {}),
      ...(patch ? { diff: patch } : {}),
      ...(artifact.edit_id ? { edit_id: artifact.edit_id } : {}),
      ...(artifact.review_status ? { review_status: artifact.review_status } : {}),
      ...(artifact.can_apply != null ? { can_apply: artifact.can_apply } : {}),
      ...(artifact.can_revert != null ? { can_revert: artifact.can_revert } : {}),
      agent_task_id: artifact.task_id || list.task_id,
      ...(artifact.edge_run_id || list.edge_run_id ? { edge_run_id: artifact.edge_run_id || list.edge_run_id } : {}),
    },
    ...(artifact.created_at ? { created_at: artifact.created_at } : {}),
  };
}

function isTaskFileChangeArtifact(artifact: AgentTaskArtifact): boolean {
  const kind = normalizedStatus(artifact.type || artifact.kind || artifact.status);
  return kind === 'file_change' || kind === 'diff' || Boolean(artifact.diff || artifact.patch || artifact.edit_id);
}

function taskApprovalDecision(status: string | undefined): 'allow' | 'deny' {
  return status === 'denied' || status === 'deny' || status === 'rejected' || status === 'failed'
    ? 'deny'
    : 'allow';
}

function normalizedStatus(status: string | undefined): string | undefined {
  return status?.trim().toLowerCase();
}

function resolveWebTaskContractStatusBlocks(
  taskId: string | undefined,
  approvalError: unknown,
  artifactError: unknown,
): TranscriptBlock[] {
  if (!taskId) return [];
  const blocks: TranscriptBlock[] = [];
  if (approvalError) {
    blocks.push(webTaskContractErrorBlock(
      'approvals',
      taskId,
      `Hub task approvals unavailable: ${errorMessage(approvalError, 'approval endpoint failed')}`,
    ));
  }
  if (artifactError) {
    blocks.push(webTaskContractErrorBlock(
      'artifacts',
      taskId,
      `Hub task artifacts unavailable: ${errorMessage(artifactError, 'artifact endpoint failed')}`,
    ));
  }
  return blocks;
}

function webTaskContractErrorBlock(channel: 'approvals' | 'artifacts', taskId: string, text: string): TranscriptBlock {
  return {
    id: `web-hub-task-contract-${channel}-${taskId}`,
    kind: 'text',
    author: { id: 'hub-task-contract', name: 'Hub task contract', role: 'system' },
    text,
    badgeLabel: 'Real Hub error',
    badgeVariant: 'danger',
  };
}

export function resolveWebRuntimeEvidence(transcript: TranscriptBlock[]): RuntimeEvidenceSnapshot {
  const runId = resolveCurrentTranscriptRunId(transcript);
  const evidence = collectTranscriptEvidence(transcript);
  const fileChangeBlocks = transcript.filter((block): block is Extract<TranscriptBlock, { kind: 'file_change' }> =>
    block.kind === 'file_change'
  );
  const artifactBlocks = transcript.filter((block): block is Extract<TranscriptBlock, { kind: 'artifact' }> =>
    block.kind === 'artifact'
  );
  const previewBlocks = transcript.filter((block): block is Extract<TranscriptBlock, { kind: 'preview' }> =>
    block.kind === 'preview'
  );
  const artifacts = artifactBlocks.map((block) => ({
    id: block.artifactId ?? artifactIdFromEvidence(block.evidenceRefs?.find((ref) => ref.kind === 'artifact')?.id) ?? block.id,
    runId: artifactRunId(block, runId),
    threadId: block.threadId ?? '',
    kind: block.artifactKind ?? 'artifact',
    path: block.path ?? block.title,
    sizeBytes: 0,
    createdAt: block.createdAt ?? '',
  }));
  const diffs = fileChangeBlocks
    .filter((block) => block.patch || block.lines?.length || block.editId || block.reviewStatus)
    .map(fileChangeBlockToDiff);
  const previews = previewBlocks.map((block) => ({
    id: block.previewId,
    runId: previewRunId(block, runId),
    threadId: block.threadId ?? '',
    ...(block.url ? { url: block.url } : {}),
    status: previewStatus(block.status),
    createdAt: block.createdAt ?? '',
  }));
  return {
    ...(runId ? { runId } : {}),
    diffs,
    artifacts,
    previews,
    sources: {
      diff: diffs.length > 0 ? 'event' : 'none',
      artifacts: evidence.some((ref) => ref.kind === 'artifact') ? 'event' : 'none',
      previews: evidence.some((ref) => ref.kind === 'preview') ? 'event' : 'none',
    },
  };
}

function fileChangeBlockToDiff(block: Extract<TranscriptBlock, { kind: 'file_change' }>): FileDiff {
  return {
    filePath: block.path,
    status: fileDiffStatus(block.action),
    additions: block.additions ?? block.lines?.filter((line) => line.type === 'add').length ?? 0,
    deletions: block.deletions ?? block.lines?.filter((line) => line.type === 'del').length ?? 0,
    hunks: [{
      header: '@@ Hub task file change @@',
      lines: (block.lines ?? []).map((line) => ({
        type: line.type === 'add' ? 'added' : line.type === 'del' ? 'deleted' : 'context',
        content: line.content,
      })),
    }],
    ...(block.editId ? { editId: block.editId } : {}),
    ...(block.reviewStatus ? { reviewStatus: block.reviewStatus } : {}),
    ...(block.canApply != null ? { canApply: block.canApply } : {}),
    ...(block.canRevert != null ? { canRevert: block.canRevert } : {}),
  };
}

function fileDiffStatus(action: Extract<TranscriptBlock, { kind: 'file_change' }>['action']): FileDiff['status'] {
  if (action === 'created') return 'added';
  if (action === 'deleted') return 'deleted';
  return 'modified';
}

function artifactIdFromEvidence(id: string | undefined): string | undefined {
  if (!id?.startsWith('artifact-')) return undefined;
  return id.slice('artifact-'.length);
}

function artifactRunId(block: Extract<TranscriptBlock, { kind: 'artifact' }>, fallback: string | undefined): string {
  return block.evidenceRefs
    ?.find((ref) => ref.kind === 'run')
    ?.id
    .replace(/^run-/, '') ?? fallback ?? '';
}

function previewRunId(block: Extract<TranscriptBlock, { kind: 'preview' }>, fallback: string | undefined): string {
  return block.evidenceRefs
    ?.find((ref) => ref.kind === 'run')
    ?.id
    .replace(/^run-/, '') ?? fallback ?? '';
}

function previewStatus(status: string): 'starting' | 'ready' | 'stopped' {
  if (status === 'running' || status === 'pending') return 'starting';
  if (status === 'failed') return 'stopped';
  return 'ready';
}

export { hubEmptyContacts as webHubEmptyContacts } from '@shared/workbench/hubDataMapping';

export { contactInfoToMember } from '@shared/workbench/hubDataMapping';

export { resolveHubContacts as resolveWebWorkbenchContacts } from '@shared/workbench/hubDataMapping';

export function resolveWebWorkbenchProjects(
  projects: WorkspaceProject[] | undefined,
  hubReady: boolean,
  dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE),
  projectGroups?: Record<string, WorkspaceProjectGroupProjection | undefined>,
): ProjectInfo[] | undefined {
  if (!hubReady) {
    return isWorkbenchFixtureDataMode(dataMode) ? undefined : [];
  }
  return (projects ?? []).map((project) => workspaceProjectToProjectInfo(project, projectGroups?.[project.id]));
}

export interface WorkspaceProjectGroupProjection {
  threads: WorkspaceProjectThread[];
  messages: WorkspaceProjectThreadMessage[];
}

export interface ParsedProjectThreadMessageContent {
  text: string;
  agentMentions: string[];
  queue?: {
    status?: string | undefined;
    route?: string | undefined;
    correlationId?: string | undefined;
  } | undefined;
}

export function workspaceProjectToProjectInfo(
  project: WorkspaceProject,
  group?: WorkspaceProjectGroupProjection,
): ProjectInfo {
  const description = project.description?.trim() || 'Hub workspace project';
  const threads = group?.threads ?? [];
  const messages = group?.messages ?? [];
  const parsedMessages = messages.map(parseWorkspaceProjectThreadMessageContent);
  const queueRuns = parsedMessages
    .map((parsed, index) => projectQueueRunFromMessage(messages[index]!, parsed))
    .filter((run): run is ProjectInfo['runs'][number] => Boolean(run));
  const threadRuns = threads.map(projectThreadToRun);
  const members = uniqueNonEmpty([
    ...threads.map((thread) => thread.role),
    ...parsedMessages.flatMap((message) => message.agentMentions),
  ]);
  const recentMessages = messages.slice(-4);
  const recentParsedMessages = parsedMessages.slice(-4);
  const feed = [
    ...recentMessages.map((message, index) => projectMessageToFeedItem(message, recentParsedMessages[index])),
    ...threads.slice(0, Math.max(0, 4 - Math.min(messages.length, 4))).map(projectThreadToFeedItem),
  ];
  return {
    id: project.id,
    name: project.name?.trim() || '未命名项目',
    description,
    status: group ? 'Hub group' : 'Hub',
    meta: group
      ? `${threads.length} threads · ${messages.length} messages`
      : '0 runs',
    members,
    announcement: description,
    runs: [...threadRuns, ...queueRuns],
    artifacts: [],
    feed,
  };
}

export function parseWorkspaceProjectThreadMessageContent(
  message: WorkspaceProjectThreadMessage,
): ParsedProjectThreadMessageContent {
  const content = parseJsonRecord(message.content);
  const metadata = parseJsonRecord(content?.metadata);
  const rawMentions = Array.isArray(metadata?.mentions) ? metadata.mentions : [];
  const queue = parseJsonRecord(metadata?.orchestrator_queue);
  const text = firstString(content?.text, content?.content, message.content);
  const agentMentions = rawMentions
    .map((mention) => parseJsonRecord(mention))
    .filter((mention) => mention?.type === 'agent' || mention?.agent === true || mention?.id)
    .map((mention) => firstString(mention?.display_name, mention?.name, mention?.id))
    .filter((name): name is string => Boolean(name));

  return {
    text,
    agentMentions: uniqueNonEmpty(agentMentions),
    ...(queue ? {
      queue: {
        status: firstString(queue.status),
        route: firstString(queue.route),
        correlationId: firstString(queue.correlation_id, queue.correlationId),
      },
    } : {}),
  };
}

function projectThreadToRun(thread: WorkspaceProjectThread): ProjectInfo['runs'][number] {
  return {
    id: `thread-${thread.id}`,
    name: `Project group: ${thread.name || thread.id}`,
    status: thread.last_message_at ? 'running' : 'waiting',
    owner: thread.role || 'Hub',
    meta: `${thread.member_count ?? 0} members`,
  };
}

function projectQueueRunFromMessage(
  message: WorkspaceProjectThreadMessage,
  parsed: ParsedProjectThreadMessageContent,
): ProjectInfo['runs'][number] | undefined {
  if (!parsed.queue) return undefined;
  const route = parsed.queue.route || 'orchestrator';
  return {
    id: `queue-${message.id}`,
    name: `Orchestrator queue: ${route}`,
    status: projectQueueStatus(parsed.queue.status),
    owner: parsed.agentMentions[0] || 'Orchestrator',
    meta: parsed.queue.correlationId || parsed.queue.status || `seq ${message.seq_id}`,
  };
}

function projectQueueStatus(status: string | undefined): ProjectInfo['runs'][number]['status'] {
  const normalized = status?.trim().toLowerCase();
  if (normalized === 'running' || normalized === 'dispatched') return 'running';
  if (normalized === 'completed' || normalized === 'done' || normalized === 'succeeded') return 'completed';
  if (normalized === 'failed' || normalized === 'cancelled') return normalized;
  return 'waiting';
}

function projectMessageToFeedItem(
  message: WorkspaceProjectThreadMessage,
  parsed: ParsedProjectThreadMessageContent | undefined,
): ProjectInfo['feed'][number] {
  const content = parsed ?? parseWorkspaceProjectThreadMessageContent(message);
  const agentSuffix = content.agentMentions.length > 0 ? ` -> @${content.agentMentions.join(', @')}` : '';
  const queueSuffix = content.queue?.status ? ` · queue ${content.queue.status}` : '';
  return {
    id: `message-${message.id}`,
    time: projectDisplayTime(message.created_at),
    text: `${content.text}${agentSuffix}${queueSuffix}`,
  };
}

function projectThreadToFeedItem(thread: WorkspaceProjectThread): ProjectInfo['feed'][number] {
  return {
    id: `thread-${thread.id}`,
    time: projectDisplayTime(thread.last_message_at || thread.created_at),
    text: `Project group thread: ${thread.name || thread.id} · ${thread.member_count ?? 0} members`,
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function projectDisplayTime(value: string | undefined): string {
  if (!value) return 'Hub';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(11, 16);
}

export function mergeWorkspaceProjectDetail(
  projects: WorkspaceProject[] | undefined,
  detail: WorkspaceProject | undefined,
): WorkspaceProject[] | undefined {
  if (!detail) return projects;
  const current = projects ?? [];
  if (current.length === 0) return [detail];
  let found = false;
  const merged = current.map((project) => {
    if (project.id !== detail.id) return project;
    found = true;
    return { ...project, ...detail };
  });
  return found ? merged : [detail, ...current];
}

export function projectDraftToHubRequest(draft: ProjectDraft): { name: string; description: string } {
  return {
    name: draft.name.trim() || '未命名项目',
    description: draft.description.trim(),
  };
}

export function resolveWebProjectsStatus(
  projects: { isFetching: boolean; error?: unknown },
  createError: unknown,
  updateError: unknown,
  hubReady: boolean,
  dataMode: WorkbenchDataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE),
  saving = false,
  selectedProject: { isFetching: boolean; error?: unknown } = { isFetching: false },
  projectGroups: { isFetching: boolean; error?: unknown } = { isFetching: false },
): { loading: boolean; error?: string | undefined; actionError?: string | undefined; saving: boolean } {
  const realMode = isWorkbenchRealDataMode(dataMode);
  const effectiveRealMode = hubReady || realMode;
  const signedOutRealMode = realMode && !hubReady;
  return {
    loading: effectiveRealMode && (projects.isFetching || selectedProject.isFetching || projectGroups.isFetching),
    error: signedOutRealMode
      ? 'Sign in to Hub to load workspace projects.'
      : effectiveRealMode && projects.error
        ? errorMessage(projects.error, 'Hub Projects 加载失败')
        : effectiveRealMode && selectedProject.error
          ? errorMessage(selectedProject.error, 'Hub Project 详情加载失败')
          : effectiveRealMode && projectGroups.error
            ? errorMessage(projectGroups.error, 'Hub Project Group 加载失败')
        : undefined,
    actionError: effectiveRealMode ? errorMessage(createError ?? updateError, '') || undefined : undefined,
    saving,
  };
}

export type WebExecutionTargetStatusState =
  | 'hidden'
  | 'signed-out'
  | 'loading'
  | 'error'
  | 'no-target'
  | 'offline'
  | 'degraded'
  | 'mismatch'
  | 'stale'
  | 'wrong-profile'
  | 'ready';

export interface WebExecutionTargetStatus {
  state: WebExecutionTargetStatusState;
  selectedTarget?: ExecutionTargetInventoryItem | undefined;
  block?: TranscriptBlock | undefined;
}

export function resolveWebExecutionTargetStatus(input: {
  hubReady: boolean;
  dataMode: WorkbenchDataMode;
  isFetching: boolean;
  error: unknown;
  targets: ExecutionTargetInventoryItem[] | undefined;
}): WebExecutionTargetStatus {
  const visibleRealMode = input.hubReady || isWorkbenchRealDataMode(input.dataMode);
  if (!visibleRealMode) return { state: 'hidden' };
  if (!input.hubReady) {
    return targetStatus('signed-out', 'Sign in to Hub before Web can select a local_edge execution target.');
  }
  if (input.isFetching && !input.targets) {
    return targetStatus('loading', 'Loading Hub execution targets before Web dispatch.');
  }
  if (input.error) {
    return targetStatus('error', `Hub execution targets unavailable: ${errorMessage(input.error, 'Hub target inventory failed')}`);
  }

  const targets = input.targets ?? [];
  if (targets.length === 0) {
    return targetStatus(
      'no-target',
      'No online local_edge execution target is available. Web real Hub mode will not dispatch agent tasks to mock targets.',
    );
  }

  const localEdgeTargets = targets.filter((target) => target.target_type === 'local_edge');
  if (localEdgeTargets.length === 0) {
    return targetStatus(
      'wrong-profile',
      'Hub reported execution targets, but none are local_edge Desktop/Edge targets for Web agent dispatch.',
    );
  }

  const selectedTarget = localEdgeTargets.find((target) =>
    target.is_online === true && (target.health_state === 'online' || target.health_state === 'healthy')
  );
  if (!selectedTarget) {
    const mismatchTarget = localEdgeTargets.find((target) => target.health_state === 'mismatch');
    if (mismatchTarget) {
      return targetStatus(
        'mismatch',
        `Desktop/Edge target binding mismatch: ${executionTargetLabel(mismatchTarget)}. Web will not dispatch until Hub target and Desktop Edge identity match.`,
      );
    }
    const staleTarget = localEdgeTargets.find((target) => target.health_state === 'stale');
    if (staleTarget) {
      return targetStatus(
        'stale',
        `Desktop/Edge target health is stale: ${executionTargetLabel(staleTarget)}. Web will wait for a fresh Desktop check-in before dispatch.`,
      );
    }
    const degradedTarget = localEdgeTargets.find((target) =>
      target.is_online === true && target.health_state === 'degraded'
    );
    if (degradedTarget) {
      return targetStatus(
        'degraded',
        `Desktop/Edge target is degraded: ${executionTargetLabel(degradedTarget)}. Web will wait for a healthy target before dispatch.`,
      );
    }
    return targetStatus(
      'offline',
      'Desktop/Edge local_edge targets are offline or unavailable. Web real Hub mode will not dispatch agent tasks to mock targets.',
    );
  }

  return {
    state: 'ready',
    selectedTarget,
    block: targetStatusBlock(
      'ready',
      `Selected local_edge execution target: ${selectedTarget.name || selectedTarget.id} (${selectedTarget.id}).`,
    ),
  };
}

function targetStatus(state: Exclude<WebExecutionTargetStatusState, 'hidden' | 'ready'>, text: string): WebExecutionTargetStatus {
  return {
    state,
    selectedTarget: undefined,
    block: targetStatusBlock(state, text),
  };
}

function executionTargetLabel(target: Pick<ExecutionTargetInventoryItem, 'id' | 'name'>): string {
  return target.name ? `${target.name} (${target.id})` : target.id;
}

function targetStatusBlock(state: WebExecutionTargetStatusState, text: string): TranscriptBlock {
  return {
    id: `web-hub-execution-target-${state}`,
    kind: 'text',
    author: { id: 'hub-targets', name: 'Hub targets', role: 'system' },
    text,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export function resolveWebWorkbenchTranscript(
  hubReady: boolean,
  activeHubSessionId: string | null,
  messages: HubMessageTranscriptInput[] | undefined,
  liveRuntimeEvents: HubRuntimeEventTranscriptInput[],
  dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE),
): TranscriptBlock[] {
  if (!hubReady) {
    return isWorkbenchRealDataMode(dataMode)
      ? webHubEmptyTranscript
      : resolveDemoWorkbenchTranscript(WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID);
  }
  if (activeHubSessionId) {
    return [
      ...normalizeHubMessagesToTranscript(messages),
      ...normalizeHubRuntimeEventsToTranscript(liveRuntimeEvents),
    ];
  }
  return isWorkbenchRealDataMode(dataMode)
    ? webHubEmptyTranscript
    : resolveDemoWorkbenchTranscript(WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID);
}

export function appendHubRuntimeEvent(
  current: HubRuntimeEventTranscriptInput[],
  incoming: HubRuntimeEventTranscriptInput,
  limit = 200,
): HubRuntimeEventTranscriptInput[] {
  const incomingKey = hubRuntimeEventKey(incoming);
  const replaced = current.filter((event) => hubRuntimeEventKey(event) !== incomingKey);
  return [...replaced, incoming].slice(-limit);
}

export function mergeHubRuntimeEvents(
  replayed: HubRuntimeEventTranscriptInput[] | undefined,
  live: HubRuntimeEventTranscriptInput[],
  limit = 400,
): HubRuntimeEventTranscriptInput[] {
  let merged = replayed ?? [];
  for (const event of live) {
    merged = appendHubRuntimeEvent(merged, event, limit);
  }
  return merged.slice(-limit);
}

function hubRuntimeEventKey(event: HubRuntimeEventTranscriptInput): string {
  return event.id ?? [
    event.task_id,
    event.edge_run_id,
    event.event_seq,
    event.event_type,
  ].filter((part) => part != null && String(part).trim()).join(':');
}
