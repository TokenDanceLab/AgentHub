import { useMemo, useSyncExternalStore, useEffect } from 'react';
import {
  demoWorkbenchAgents,
  getWorkbenchDataModeOverrideSnapshot,
  isWorkbenchRealDataMode,
  resolveWorkbenchDataMode,
  subscribeWorkbenchDataModeOverride,
  workbenchDemoRuntimeStore,
  type WorkbenchDataMode,
} from '@shared/demo';
import { normalizeThreadItemsToTranscript } from '@shared/transcript';
import { normalizeHubMessagesToTranscript } from '@shared/transcript';
import { getAgentActivityStore, type AgentActivitySnapshot } from '@shared/transcript/agentActivity';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { ThreadInfo, ThreadItemInfo, ThreadPinInfo } from '@shared/types';
import type { ProjectDraft, ProjectInfo } from '@shared/workbench';
import type { WorkbenchContactsData } from '@shared/workbench';
import type { WorkbenchContactsActions } from '@shared/workbench/WorkbenchRoutes';
import {
  resolveHubContacts,
  resolveHubProjects,
  hubSessionToConversation,
  type HubContactLike,
} from '@shared/workbench/hubDataMapping';
import { useThreadMessages, useThreadPins, useThreads } from '@/api/threadQueries';
import { useHubSessions, useHubMessages, useHubSendMessage, useHubRecallMessage, useHubEditMessage, useHubPinMessage, useHubUnpinMessage, useHubMarkRead } from '@/api/sessionQueries';
import {
  useHubContacts,
  useHubSearchUser,
  useHubSendFriendRequest,
  useHubAcceptFriendRequest,
  useHubRejectFriendRequest,
  useHubRemoveContact,
  useHubBlockContact,
  useHubUnblockContact,
  useHubUpdateContactRemark,
  useHubCreateContactGroup,
  useHubWorkspaceProjects,
  useCreateHubWorkspaceProject,
  useUpdateHubWorkspaceProject,
} from '@/api/hubQueries';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { useDesktopEdgeEvents } from './useDesktopEdgeEvents';
import { useHubWebSocket } from '@/hooks/useHubWebSocket';
import { useQueryClient } from '@tanstack/react-query';

export interface DesktopChatActions {
  sendMessage: (sessionId: string, content: string, contentType?: string) => Promise<unknown>;
  recallMessage: (messageId: string) => Promise<unknown>;
  editMessage: (messageId: string, content: string) => Promise<unknown>;
  pinMessage: (messageId: string, sessionId: string) => Promise<unknown>;
  unpinMessage: (messageId: string, sessionId: string) => Promise<unknown>;
  markRead: (sessionId: string, lastReadSeq: number) => Promise<unknown>;
}

export interface DesktopWorkbenchModel {
  activeConversationId: string;
  activeProjectId?: string;
  activeThreadId?: string;
  agents: WorkbenchAgent[];
  conversations: WorkbenchConversation[];
  contacts?: WorkbenchContactsData;
  contactsActions?: WorkbenchContactsActions;
  chatActions?: DesktopChatActions;
  dataMode: string;
  isDemo: boolean;
  projects?: ProjectInfo[];
  projectsStatus?: {
    loading?: boolean;
    error?: string;
    saving?: boolean;
  };
  projectsActions?: {
    create: (draft: ProjectDraft) => Promise<ProjectInfo>;
    update: (projectId: string, draft: ProjectDraft) => Promise<ProjectInfo>;
  };
  transcript: ReturnType<typeof normalizeThreadItemsToTranscript>;
  /** Agent activity state for the streaming status bar. */
  agentActivity?: AgentActivitySnapshot;
}

const EMPTY_TRANSCRIPT: ReturnType<typeof normalizeThreadItemsToTranscript> = [];
const DESKTOP_DEMO_DEFAULT_CONVERSATION_ID = 'agent-collab';

export function useDesktopWorkbenchModel(selectedConversationId?: string): DesktopWorkbenchModel {
  const dataModeOverride = useSyncExternalStore(
    subscribeWorkbenchDataModeOverride,
    getWorkbenchDataModeOverrideSnapshot,
    getWorkbenchDataModeOverrideSnapshot,
  );
  const dataMode = getWorkbenchDataMode(dataModeOverride);
  const demoSnapshot = useSyncExternalStore(
    workbenchDemoRuntimeStore.subscribe,
    workbenchDemoRuntimeStore.getSnapshot,
    workbenchDemoRuntimeStore.getSnapshot,
  );
  const useDemo = !isWorkbenchRealDataMode(dataMode);
  const hubAuthenticated = useHubStore((state) => state.authenticated);
  const hubReady = !useDemo && hubAuthenticated && Boolean(getAccessToken());

  // Subscribe to agent activity changes for the streaming status bar.
  const agentActivity = useSyncExternalStore(
    getAgentActivityStore().subscribe,
    getAgentActivityStore().getSnapshot,
    getAgentActivityStore().getSnapshot,
  );

  // Hub WebSocket — invalidate React Query caches when real-time events arrive.
  const queryClient = useQueryClient();
  const hubWS = useHubWebSocket({
    enabled: hubReady,
    onReconnect: () => {
      // On reconnect, invalidate agent task queries so the REST refetch
      // picks up any events missed during the WS disconnection gap.
      void queryClient.invalidateQueries({ queryKey: ['hub', 'agent-tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
    },
  });

  // When a Hub WS event arrives, invalidate the relevant query caches so
  // React Query refetches fresh data from the Hub REST API.
  useEffect(() => {
    if (!hubWS.lastEvent) return;

    const { type } = hubWS.lastEvent;
    switch (type) {
      case 'message.new':
      case 'message.edited':
      case 'message.recall':
      case 'message.pin':
      case 'message.unpin':
      case 'message.reaction_added':
      case 'message.reaction_removed':
      case 'message.read':
        void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
        break;
      case 'session.created':
      case 'session.dissolved':
      case 'session.member_joined':
      case 'session.member_left':
      case 'session.info_updated':
        void queryClient.invalidateQueries({ queryKey: ['hub', 'sessions'] });
        break;
      case 'friend.request':
      case 'friend.accepted':
        void queryClient.invalidateQueries({ queryKey: ['hub', 'contacts'] });
        break;
      case 'notification.new':
        void queryClient.invalidateQueries({ queryKey: ['hub', 'notifications'] });
        break;
    }
  }, [hubWS.lastEvent, queryClient]);

  // Hub data queries — only active in live mode when Hub is authenticated.
  const contactsQuery = useHubContacts({ enabled: hubReady });
  const projectsQuery = useHubWorkspaceProjects({ enabled: hubReady });
  const createProjectMutation = useCreateHubWorkspaceProject();
  const updateProjectMutation = useUpdateHubWorkspaceProject();

  // Hub sessions & messages — IM conversation path (alongside Edge threads).
  const hubSessionsQuery = useHubSessions({ enabled: hubReady });
  const hubSessions = hubSessionsQuery.data ?? [];

  // Contact mutation hooks.
  const searchUserMutation = useHubSearchUser();
  const sendFriendRequestMutation = useHubSendFriendRequest();
  const acceptFriendRequestMutation = useHubAcceptFriendRequest();
  const rejectFriendRequestMutation = useHubRejectFriendRequest();
  const removeContactMutation = useHubRemoveContact();
  const blockContactMutation = useHubBlockContact();
  const unblockContactMutation = useHubUnblockContact();
  const updateContactRemarkMutation = useHubUpdateContactRemark();
  const createContactGroupMutation = useHubCreateContactGroup();

  // Chat mutation hooks (Hub IM).
  const sendMessageMutation = useHubSendMessage();
  const recallMessageMutation = useHubRecallMessage();
  const editMessageMutation = useHubEditMessage();
  const pinMessageMutation = useHubPinMessage();
  const unpinMessageMutation = useHubUnpinMessage();
  const markReadMutation = useHubMarkRead();

  const threadsQuery = useThreads(undefined, { enabled: !useDemo });
  const threads = useDemo ? [] : threadsQuery.data?.items ?? [];

  // Determine whether to use Hub sessions as the primary conversation source.
  // Hub sessions provide IM/social conversations; Edge threads provide execution threads.
  const useHubConversations = hubReady && hubSessions.length > 0;

  // Active conversation: prefer Hub session match, then Edge thread match.
  const activeHubSession = useHubConversations
    ? hubSessions.find((s) => s.id === selectedConversationId) ?? hubSessions[0]
    : undefined;
  const activeThread = useDemo
    ? undefined
    : threads.find((thread) => thread.threadId === selectedConversationId) ?? threads[0];
  const activeConversationId = activeHubSession?.id ?? activeThread?.threadId ?? selectedConversationId ?? '';

  // Edge thread messages (execution path).
  const threadItemsQuery = useThreadMessages(useDemo ? null : activeThread?.threadId ?? null);
  const threadPinsQuery = useThreadPins(useDemo ? null : activeThread?.threadId ?? null);
  const threadItems = threadItemsQuery.data?.items;
  const threadPins = threadPinsQuery.data?.items;
  const persistedUntilMs = useMemo(() => latestThreadItemTimestampMs(threadItems), [threadItems]);
  const liveTranscript = useDesktopEdgeEvents(useDemo ? undefined : activeThread?.threadId, persistedUntilMs);

  // Hub session messages (IM path) — only when a Hub session is active.
  const hubMessagesQuery = useHubMessages(activeHubSession?.id ?? '', { enabled: hubReady && !!activeHubSession?.id });
  const hubMessages = hubMessagesQuery.data ?? [];

  const demoModel = useMemo(() => {
    const selectedDemoConversation = demoSnapshot.conversations.some((conversation) => conversation.id === selectedConversationId)
      ? selectedConversationId!
      : DESKTOP_DEMO_DEFAULT_CONVERSATION_ID;

    return {
      activeConversationId: selectedDemoConversation,
      agents: demoWorkbenchAgents,
      conversations: demoSnapshot.conversations,
      dataMode: dataMode === 'auto' ? 'mock (auto fallback)' : dataMode,
      isDemo: true,
      transcript: workbenchDemoRuntimeStore.resolveTranscript(selectedDemoConversation),
      agentActivity,
    };
  }, [dataMode, demoSnapshot, selectedConversationId]);

  const conversations = useMemo(() => {
    // Merge Hub sessions + Edge threads into a unified conversation list.
    const hubConversationList = useHubConversations
      ? hubSessions.map((session) => hubSessionToConversation(session))
      : [];
    const edgeConversationList = threads.map((thread) =>
      threadToConversation(
        thread,
        thread.threadId === activeThread?.threadId ? threadPins : undefined,
      ),
    );
    // Hub sessions first (IM/social), then Edge threads (execution).
    if (hubConversationList.length === 0 && edgeConversationList.length === 0) return [];
    return [...hubConversationList, ...edgeConversationList];
  }, [activeThread?.threadId, hubSessions, threadPins, threads, useHubConversations]);

  const transcript = useMemo(() => {
    // If a Hub session is active, use Hub messages for the transcript.
    if (activeHubSession) {
      return normalizeHubMessagesToTranscript(hubMessages);
    }
    // Otherwise, use the Edge thread transcript path.
    const items = threadItems ?? [];
    const persistedTranscript = normalizeThreadItemsToTranscript(items);
    if (persistedTranscript.length > 0 || liveTranscript.length > 0) {
      return [...persistedTranscript, ...liveTranscript];
    }
    if (threads.length === 0 && hubSessions.length === 0) return EMPTY_TRANSCRIPT;
    return [];
  }, [activeHubSession, hubMessages, liveTranscript, threadItems, threads.length, hubSessions.length]);

  // Resolve Hub contacts for the workbench contacts page.
  const resolvedContacts = useMemo(
    () => resolveHubContacts(
      contactsQuery.data as HubContactLike[] | undefined,
      hubReady,
      dataMode,
    ),
    [contactsQuery.data, hubReady, dataMode],
  );

  // Resolve Hub workspace projects for the workbench projects page.
  const resolvedProjects = useMemo(
    () => resolveHubProjects(
      projectsQuery.data?.items,
      hubReady,
      dataMode,
      workspaceProjectToProjectInfo,
    ),
    [projectsQuery.data?.items, hubReady, dataMode],
  );

  const resolvedProjectsStatus = hubReady ? {
    loading: projectsQuery.isFetching,
    ...(projectsQuery.error ? { error: errorMessage(projectsQuery.error, 'Hub Projects 加载失败') } : {}),
    saving: createProjectMutation.isPending || updateProjectMutation.isPending,
  } : undefined;

  const resolvedProjectsActions = hubReady ? {
    create: async (draft: ProjectDraft): Promise<ProjectInfo> => {
      const result = await createProjectMutation.mutateAsync({
        name: draft.name.trim() || '未命名项目',
        description: draft.description.trim(),
      });
      return workspaceProjectToProjectInfo(result);
    },
    update: async (projectId: string, draft: ProjectDraft): Promise<ProjectInfo> => {
      const result = await updateProjectMutation.mutateAsync({
        id: projectId,
        data: {
          name: draft.name.trim() || '未命名项目',
          description: draft.description.trim(),
        },
      });
      return workspaceProjectToProjectInfo(result);
    },
  } : undefined;

  const resolvedContactsActions: WorkbenchContactsActions | undefined = hubReady ? {
    onSearchUser: (query: string) => searchUserMutation.mutateAsync(query),
    onSendFriendRequest: (userId: string, message?: string) =>
      sendFriendRequestMutation.mutateAsync(message !== undefined ? { userId, message } : { userId }),
    onAcceptRequest: (requestId: string) => acceptFriendRequestMutation.mutateAsync(requestId),
    onRejectRequest: (requestId: string) => rejectFriendRequestMutation.mutateAsync(requestId),
    onRemoveContact: (userId: string) => removeContactMutation.mutateAsync(userId),
    onBlockContact: (userId: string) => blockContactMutation.mutateAsync(userId),
    onUnblockContact: (userId: string) => unblockContactMutation.mutateAsync(userId),
    onUpdateRemark: (userId: string, remark: string) =>
      updateContactRemarkMutation.mutateAsync({ userId, remark }),
    onCreateGroup: (name: string, memberIds: string[]) =>
      createContactGroupMutation.mutateAsync({ name, memberIds }),
  } : undefined;

  const resolvedChatActions: DesktopChatActions | undefined = hubReady ? {
    sendMessage: (sessionId: string, content: string, contentType = 'text/plain') =>
      sendMessageMutation.mutateAsync({
        sessionId,
        data: {
          client_msg_id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          content_type: contentType,
          content,
        },
      }),
    recallMessage: (messageId: string) => recallMessageMutation.mutateAsync(messageId),
    editMessage: (messageId: string, content: string) =>
      editMessageMutation.mutateAsync({ messageId, data: { content } }),
    pinMessage: (messageId: string, sessionId: string) =>
      pinMessageMutation.mutateAsync({ messageId, sessionId }),
    unpinMessage: (messageId: string, sessionId: string) =>
      unpinMessageMutation.mutateAsync({ messageId, sessionId }),
    markRead: (sessionId: string, lastReadSeq: number) =>
      markReadMutation.mutateAsync({ sessionId, lastReadSeq }),
  } : undefined;

  const liveModel = {
    activeConversationId,
    ...(activeThread?.projectId ? { activeProjectId: activeThread.projectId } : {}),
    ...(activeThread?.threadId ? { activeThreadId: activeThread.threadId } : {}),
    agents: [],
    ...(resolvedContacts != null ? { contacts: resolvedContacts } : {}),
    ...(resolvedContactsActions != null ? { contactsActions: resolvedContactsActions } : {}),
    ...(resolvedChatActions != null ? { chatActions: resolvedChatActions } : {}),
    conversations,
    dataMode,
    isDemo: false,
    ...(resolvedProjects != null ? { projects: resolvedProjects } : {}),
    ...(resolvedProjectsStatus != null ? { projectsStatus: resolvedProjectsStatus } : {}),
    ...(resolvedProjectsActions != null ? { projectsActions: resolvedProjectsActions } : {}),
    ...(resolvedChatActions != null ? { chatActions: resolvedChatActions } : {}),
    transcript,
    agentActivity,
  };

  return useDemo ? demoModel : liveModel;
}

function getWorkbenchDataMode(override: WorkbenchDataMode | undefined): WorkbenchDataMode {
  return resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE, override);
}

function threadToConversation(thread: ThreadInfo, pins?: ThreadPinInfo[]): WorkbenchConversation {
  const updatedLabel = thread.updatedAt ? formatTimestamp(thread.updatedAt) : undefined;

  const conversation: WorkbenchConversation = {
    id: thread.threadId,
    title: thread.title?.trim() || '未命名会话',
    kind: (thread.kind === 'direct' || thread.kind === 'group') ? thread.kind : 'group',
    subtitle: threadSubtitle(thread),
    updatedLabel,
    avatarColor: thread.avatarColor,
    avatarLabel: thread.avatarLabel,
  };
  const pin = pins?.[0];
  if (pin?.item?.content) {
    conversation.pinnedAnnouncement = {
      title: conversation.title,
      content: pin.item.content,
      author: pin.pinnedBy || pin.item.role || 'Edge',
      time: formatPinTime(pin.pinnedAt),
      sourceId: pin.itemId,
    };
  }
  return conversation;
}

function threadSubtitle(thread: ThreadInfo): string {
  return thread.status?.trim() || 'active';
}

function formatTimestamp(timestamp: string): string | undefined {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  });
}

function latestThreadItemTimestampMs(items: ThreadItemInfo[] | undefined): number | undefined {
  if (!items?.length) return undefined;

  let latest = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const parsed = Date.parse(item.createdAt);
    if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
  }

  return Number.isFinite(latest) ? latest : undefined;
}

function formatPinTime(timestamp: string): string | undefined {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function workspaceProjectToProjectInfo(
  project: { id: string; name?: string; description?: string; created_at?: string; updated_at?: string },
): ProjectInfo {
  const description = project.description?.trim() || 'Hub workspace project';
  return {
    id: project.id,
    name: project.name?.trim() || '未命名项目',
    description,
    status: 'Hub',
    meta: '0 runs',
    members: [],
    announcement: description,
    runs: [],
    artifacts: [],
    feed: [],
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}
