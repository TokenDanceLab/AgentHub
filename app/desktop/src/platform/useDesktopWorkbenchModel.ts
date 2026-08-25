import { useMemo, useSyncExternalStore, useEffect, useState, useCallback, useRef } from 'react';
import {
  demoWorkbenchAgents,
  getWorkbenchDataModeContract,
  getWorkbenchDataModeOverrideSnapshot,
  resolveWorkbenchDataMode,
  subscribeWorkbenchDataModeOverride,
  workbenchDemoRuntimeStore,
  type WorkbenchDataMode,
} from '@shared/demo';
import { normalizeThreadItemsToTranscript } from '@shared/transcript';
import { appDateLocaleTag } from '@shared/i18n/locale';
import { getI18n } from 'react-i18next';
import { normalizeHubMessagesToTranscript } from '@shared/transcript';
import { orderTranscriptBlocks } from '@shared/transcript';
import { getPinMapStore, withPinnedState } from '@shared/transcript';
import { getAgentActivityStore, type AgentActivitySnapshot } from '@shared/transcript/agentActivity';
import { computeTranscriptUnreadMarker, type TranscriptUnreadMarker } from '@/components/IM/transcriptUnreadMarker';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { ThreadInfo, ThreadItemInfo, ThreadPinInfo } from '@shared/types';
import type { ProjectDraft, ProjectInfo } from '@agenthub/workbench';
import type { WorkbenchContactsData } from '@agenthub/workbench';
import type { WorkbenchContactsActions } from '@agenthub/workbench/WorkbenchRoutes';
import {
  resolveHubContacts,
  resolveHubProjects,
  hubSessionToConversation,
  type HubContactLike,
} from '@agenthub/workbench/hubDataMapping';
import { useThreadMessages, useThreadPins, useThreads } from '@/api/threadQueries';
import { useHubSessions, useHubMessages, useHubPinnedMessages, useHubSendMessage, useHubRecallMessage, useHubEditMessage, useHubPinMessage, useHubUnpinMessage, useHubMarkRead } from '@/api/sessionQueries';
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
import { fetchHealth } from '@/api/edgeClient';
import { HEALTH_POLL_MS } from '@/config';

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
  /** When isDemo=true, indicates whether auto mode is using Local Edge fallback data. */
  edgeDemoData?: boolean;
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
  /**
   * Unread-messages marker for the IM transcript (T8): anchor block id of the
   * first unread message derived from the Hub session read watermark
   * (unread_count = next_seq − last_read_seq). Present only for Hub IM
   * sessions with unread messages. The shell renders the divider copy.
   */
  transcriptUnread?: TranscriptUnreadMarker | undefined;
  /** Agent activity state for the streaming status bar. */
  agentActivity?: AgentActivitySnapshot;
  /** Whether threads are currently being fetched (first load or refetching). */
  threadsLoading?: boolean;
  /** Whether thread items/messages are currently being fetched. */
  itemsLoading?: boolean;
  /** Error from thread fetch, if any. */
  threadsError?: string;
  /** Error from thread items fetch, if any. */
  itemsError?: string;
}

const EMPTY_TRANSCRIPT: ReturnType<typeof normalizeThreadItemsToTranscript> = [];
const DESKTOP_DEMO_DEFAULT_CONVERSATION_ID = 'agent-collab';

/**
 * Lightweight Edge health check for auto mode.
 * Polls /v1/health only when auto mode allows Local Edge fallback.
 */
function useEdgeAvailableForDemo(enabled: boolean): boolean {
  const [available, setAvailable] = useState(false);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      await fetchHealth();
      if (mountedRef.current) setAvailable(true);
    } catch {
      if (mountedRef.current) setAvailable(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      // State reset for the disabled branch happens via the render-time
      // adjustment below; the effect only manages polling lifecycle.
      return;
    }
    queueMicrotask(() => { void poll(); });
    const id = setInterval(poll, HEALTH_POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [enabled, poll]);

  // Adjust state during render when the enabled flag flips (sanctioned
  // "adjusting state when a prop changes" pattern) so the poll result cannot
  // be stale after re-enabling.
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled);
    if (!enabled) setAvailable(false);
  }

  return enabled && available;
}

/**
 * Stable conversation id for one Hub session (#1972). Real REST
 * `/client/sessions` payloads carry snake_case `session_id`; compatibility
 * fixtures and older clients may still carry `id`. Selection matching and
 * query activation must use `(id ?? session_id)`, otherwise the real REST
 * shape leaves Hub message/pin queries disabled.
 */
function hubSessionMatchId(session: { id?: string; session_id?: string }): string | undefined {
  return session.id ?? session.session_id;
}

export function useDesktopWorkbenchModel(
  selectedConversationId?: string,
  t?: (key: string) => string,
): DesktopWorkbenchModel {
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
  const dataModeContract = getWorkbenchDataModeContract(dataMode);
  const useDemo = !dataModeContract.isRealDataMode;
  // In auto mode, detect whether Edge is available. Explicit mock/fixture modes
  // do not probe Local Edge or fall through to real API data.
  const edgeAvailableForDemo = useEdgeAvailableForDemo(useDemo && dataModeContract.allowsLocalEdgeAutoFallback);
  // When auto mode + Edge available, load data from Edge API.
  const useEdgeDemoData = useDemo && dataModeContract.allowsLocalEdgeAutoFallback && edgeAvailableForDemo;
  const hubAuthenticated = useHubStore((state) => state.authenticated);
  const hubReady = !useDemo && hubAuthenticated && Boolean(getAccessToken());

  // Subscribe to agent activity changes for the streaming status bar.
  const agentActivity = useSyncExternalStore(
    getAgentActivityStore().subscribe,
    getAgentActivityStore().getSnapshot,
    getAgentActivityStore().getSnapshot,
  );

  // Subscribe to the session-scoped pinMap store: MESSAGE_PIN/MESSAGE_UNPIN
  // frames (hubEventBridge) and the /pins endpoint seed below feed it, and the
  // normalize pipeline merges `pinned` into HubMessageTranscriptInput from it.
  const pinnedSnapshot = useSyncExternalStore(
    getPinMapStore().subscribe,
    getPinMapStore().getSnapshot,
    getPinMapStore().getSnapshot,
  );

  // Hub WS real-time ingestion for the workbench runs through
  // DesktopHubTaskBridge → useHubEventStream (api/hubWS subprotocol auth);
  // per-event cache invalidation is handled by the central hubEventBridge.
  // (The former useHubWebSocket ?token= stack never authenticated and was
  // removed in #1363.)

  // Hub data queries — only active in live mode when Hub is authenticated.
  const contactsQuery = useHubContacts({ enabled: hubReady });
  const projectsQuery = useHubWorkspaceProjects({ enabled: hubReady });
  const createProjectMutation = useCreateHubWorkspaceProject();
  const updateProjectMutation = useUpdateHubWorkspaceProject();

  // Hub sessions & messages — IM conversation path (alongside Edge threads).
  const hubSessionsQuery = useHubSessions({ enabled: hubReady });
  const hubSessions = useMemo(() => hubSessionsQuery.data ?? [], [hubSessionsQuery.data]);

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

  // Enable Edge queries in demo mode when Edge is available.
  const edgeEnabled = !useDemo || useEdgeDemoData;
  const threadsQuery = useThreads(undefined, { enabled: edgeEnabled });
  const threads = useMemo(
    () => (edgeEnabled ? (threadsQuery.data?.items ?? []) : []),
    [edgeEnabled, threadsQuery.data?.items],
  );

  // Determine whether to use Hub sessions as the primary conversation source.
  // Hub sessions provide IM/social conversations; Edge threads provide execution threads.
  const useHubConversations = hubReady && hubSessions.length > 0;

  // Active conversation: match explicit selection first.
  // Never fall back to hubSessions[0] when the user is on an Edge thread (or any
  // non-Hub id) — that steals Edge selection whenever any Hub session exists (#1010).
  const matchedHubSession = useHubConversations
    ? hubSessions.find((s) => hubSessionMatchId(s) === selectedConversationId)
    : undefined;
  const matchedThread = edgeEnabled
    ? threads.find((thread) => thread.threadId === selectedConversationId)
    : undefined;
  // Default only when there is no intentional selection id.
  const activeHubSession = matchedHubSession
    ?? (!selectedConversationId && useHubConversations ? hubSessions[0] : undefined);
  const activeThread = matchedThread
    ?? (!selectedConversationId && !activeHubSession && edgeEnabled ? threads[0] : undefined);
  // Conversation id derivation aligned with hubSessionToConversation (#1972):
  // real REST sessions only carry snake_case session_id.
  const activeHubSessionId = activeHubSession ? hubSessionMatchId(activeHubSession) : undefined;
  const activeConversationId = activeHubSessionId ?? activeThread?.threadId ?? selectedConversationId ?? '';

  // Edge thread messages (execution path).
  const threadItemsQuery = useThreadMessages(edgeEnabled ? activeThread?.threadId ?? null : null);
  const threadPinsQuery = useThreadPins(edgeEnabled ? activeThread?.threadId ?? null : null);
  const threadItems = threadItemsQuery.data?.items;
  const threadPins = threadPinsQuery.data?.items;
  const persistedUntilMs = useMemo(() => latestThreadItemTimestampMs(threadItems), [threadItems]);
  const liveTranscript = useDesktopEdgeEvents(edgeEnabled ? activeThread?.threadId : undefined, persistedUntilMs);

  // Hub session messages (IM path) — only when a Hub session is active.
  const hubMessagesQuery = useHubMessages(activeHubSessionId ?? '', { enabled: hubReady && !!activeHubSessionId });
  const hubMessages = useMemo(() => hubMessagesQuery.data ?? [], [hubMessagesQuery.data]);

  // Hub session pins — seed the pinMap store from GET /client/sessions/{id}/pins.
  // Keyed per session (query key matches hubQueryKeys.threads.pins, which
  // hubEventBridge invalidates on MESSAGE_PIN/MESSAGE_UNPIN); each arrival
  // re-seeds the session bucket (server list is authoritative).
  const hubPinsQuery = useHubPinnedMessages(activeHubSessionId ?? '', { enabled: hubReady && !!activeHubSessionId });
  useEffect(() => {
    if (activeHubSessionId && hubPinsQuery.data) {
      getPinMapStore().loadPinnedForSession(
        activeHubSessionId,
        hubPinsQuery.data.map((message) => message.id),
      );
    } else if (!activeHubSessionId) {
      // Signed out / no Hub session: drop the session pointer so stale frames
      // can never leak into a later session.
      getPinMapStore().setActiveSession(null);
    }
  }, [activeHubSessionId, hubPinsQuery.data]);

  const demoModel = useMemo(() => {
    // When auto mode can use Local Edge fallback, use Edge API data for
    // conversations and transcript so the right sidebar gets real evidence.
    if (useEdgeDemoData && threads.length > 0) {
      const edgeConversations = threads.map((thread) =>
        threadToConversation(
          thread,
          thread.threadId === activeThread?.threadId ? threadPins : undefined,
        ),
      );
      const selectedDemoConversation = selectedConversationId && edgeConversations.some((c) => c.id === selectedConversationId)
        ? selectedConversationId
        : edgeConversations[0]?.id ?? DESKTOP_DEMO_DEFAULT_CONVERSATION_ID;
      // Use the already-fetched threadItems from the active thread query.
      const items = threadItems ?? [];
      const edgeTranscript = normalizeThreadItemsToTranscript(items);
      return {
        activeConversationId: selectedDemoConversation,
        agents: demoWorkbenchAgents,
        conversations: edgeConversations,
        dataMode: dataModeContract.statusLabel,
        edgeDemoData: true as const,
        isDemo: true,
        transcript: edgeTranscript.length > 0 ? edgeTranscript : EMPTY_TRANSCRIPT,
        agentActivity,
        ...(activeThread?.projectId ? { activeProjectId: activeThread.projectId } : {}),
        ...(activeThread?.threadId ? { activeThreadId: activeThread.threadId } : {}),
        threadsLoading: threadsQuery.isLoading,
        itemsLoading: threadItemsQuery.isLoading,
        ...(threadsQuery.error ? { threadsError: errorMessage(threadsQuery.error, 'Threads 加载失败') } : {}),
        ...(threadItemsQuery.error ? { itemsError: errorMessage(threadItemsQuery.error, '消息加载失败') } : {}),
      };
    }
    // Fallback: JS mock store when Edge is unavailable.
    const selectedDemoConversation = selectedConversationId && demoSnapshot.conversations.some((conversation) => conversation.id === selectedConversationId)
      ? selectedConversationId
      : DESKTOP_DEMO_DEFAULT_CONVERSATION_ID;

    return {
      activeConversationId: selectedDemoConversation,
      agents: demoWorkbenchAgents,
      conversations: demoSnapshot.conversations,
      dataMode: dataModeContract.statusLabel,
      isDemo: true,
      transcript: workbenchDemoRuntimeStore.resolveTranscript(selectedDemoConversation),
      agentActivity,
      threadsLoading: false,
      itemsLoading: false,
      ...(threadsQuery.error ? { threadsError: errorMessage(threadsQuery.error, 'Threads 加载失败') } : {}),
      ...(threadItemsQuery.error ? { itemsError: errorMessage(threadItemsQuery.error, '消息加载失败') } : {}),
    };
  }, [dataModeContract.statusLabel, demoSnapshot, selectedConversationId, useEdgeDemoData, threads, activeThread, threadPins, threadItems, threadItemsQuery.error, threadItemsQuery.isLoading, threadsQuery.error, threadsQuery.isLoading, agentActivity]);

  const conversations = useMemo(() => {
    // Merge Hub sessions + Edge threads into a unified conversation list.
    const hubConversationList = useHubConversations
      ? hubSessions.map((session) => hubSessionToConversation(session as Parameters<typeof hubSessionToConversation>[0]))
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
      return normalizeHubMessagesToTranscript(
        // Merge the pinMap store's pinned state into the normalize input:
        // hub messages carry no pin field, so the store (fed by WS frames and
        // seeded from /pins) is the only normalize-time source.
        withPinnedState(hubMessages, pinnedSnapshot.pinnedIds),
        t,
      );
    }
    // Otherwise, use the Edge thread transcript path.
    const items = threadItems ?? [];
    const persistedTranscript = normalizeThreadItemsToTranscript(items);
    if (persistedTranscript.length > 0 || liveTranscript.length > 0) {
      return orderTranscriptBlocks([...persistedTranscript, ...liveTranscript]);
    }
    if (threads.length === 0 && hubSessions.length === 0) return EMPTY_TRANSCRIPT;
    return [];
  }, [activeHubSession, hubMessages, pinnedSnapshot, liveTranscript, threadItems, threads.length, hubSessions.length, t]);

  // IM read-watermark marker (T8): only meaningful for Hub IM sessions.
  // unread_count is the server-computed `next_seq − last_read_seq` watermark.
  const transcriptUnread = useMemo(
    () =>
      activeHubSession
        ? computeTranscriptUnreadMarker(hubMessages, activeHubSession.unread_count)
        : undefined,
    [activeHubSession, hubMessages],
  );

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
    dataMode: dataModeContract.statusLabel,
    isDemo: false,
    ...(resolvedProjects != null ? { projects: resolvedProjects } : {}),
    ...(resolvedProjectsStatus != null ? { projectsStatus: resolvedProjectsStatus } : {}),
    ...(resolvedProjectsActions != null ? { projectsActions: resolvedProjectsActions } : {}),
    ...(resolvedChatActions != null ? { chatActions: resolvedChatActions } : {}),
    transcript,
    ...(transcriptUnread ? { transcriptUnread } : {}),
    agentActivity,
    threadsLoading: threadsQuery.isLoading || (hubReady && hubSessionsQuery.isLoading),
    itemsLoading: activeHubSession ? hubMessagesQuery.isLoading : threadItemsQuery.isLoading,
    ...(threadsQuery.error || hubSessionsQuery.error
      ? {
          threadsError: errorMessage(
            threadsQuery.error ?? hubSessionsQuery.error,
            threadsQuery.error ? 'Threads 加载失败' : 'Hub sessions 加载失败',
          ),
        }
      : {}),
    ...(threadItemsQuery.error || (activeHubSession && hubMessagesQuery.error)
      ? {
          itemsError: errorMessage(
            threadItemsQuery.error ?? hubMessagesQuery.error,
            threadItemsQuery.error ? '消息加载失败' : 'Hub 消息加载失败',
          ),
        }
      : {}),
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
  return new Date(parsed).toLocaleString(appDateLocaleTag(getI18n()?.language), {
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
  return new Date(parsed).toLocaleTimeString(appDateLocaleTag(getI18n()?.language), {
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
