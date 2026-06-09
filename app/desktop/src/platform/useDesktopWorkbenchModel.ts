import { useMemo, useSyncExternalStore } from 'react';
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
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { ThreadInfo, ThreadItemInfo, ThreadPinInfo } from '@shared/types';
import type { ProjectDraft, ProjectInfo } from '@shared/workbench';
import type { WorkbenchContactsData } from '@shared/workbench';
import type { WorkbenchContactsActions } from '@shared/workbench/WorkbenchRoutes';
import {
  resolveHubContacts,
  resolveHubProjects,
  type HubContactLike,
} from '@shared/workbench/hubDataMapping';
import { useThreadMessages, useThreadPins, useThreads } from '@/api/threadQueries';
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

export interface DesktopWorkbenchModel {
  activeConversationId: string;
  activeProjectId?: string;
  activeThreadId?: string;
  agents: WorkbenchAgent[];
  conversations: WorkbenchConversation[];
  contacts?: WorkbenchContactsData;
  contactsActions?: WorkbenchContactsActions;
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

  // Hub data queries — only active in live mode when Hub is authenticated.
  const contactsQuery = useHubContacts({ enabled: hubReady });
  const projectsQuery = useHubWorkspaceProjects({ enabled: hubReady });
  const createProjectMutation = useCreateHubWorkspaceProject();
  const updateProjectMutation = useUpdateHubWorkspaceProject();

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

  const threadsQuery = useThreads(undefined, { enabled: !useDemo });
  const threads = useDemo ? [] : threadsQuery.data?.items ?? [];
  const activeThread = useDemo
    ? undefined
    : threads.find((thread) => thread.threadId === selectedConversationId) ?? threads[0];
  const activeConversationId = activeThread?.threadId ?? selectedConversationId ?? '';
  const threadItemsQuery = useThreadMessages(useDemo ? null : activeThread?.threadId ?? null);
  const threadPinsQuery = useThreadPins(useDemo ? null : activeThread?.threadId ?? null);
  const threadItems = threadItemsQuery.data?.items;
  const threadPins = threadPinsQuery.data?.items;
  const persistedUntilMs = useMemo(() => latestThreadItemTimestampMs(threadItems), [threadItems]);
  const liveTranscript = useDesktopEdgeEvents(useDemo ? undefined : activeThread?.threadId, persistedUntilMs);

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
    };
  }, [dataMode, demoSnapshot, selectedConversationId]);

  const conversations = useMemo(() => {
    if (threads.length === 0) return [];
    return threads.map((thread) =>
      threadToConversation(
        thread,
        thread.threadId === activeThread?.threadId ? threadPins : undefined,
      ),
    );
  }, [activeThread?.threadId, threadPins, threads]);

  const transcript = useMemo(() => {
    const items = threadItems ?? [];
    const persistedTranscript = normalizeThreadItemsToTranscript(items);
    if (persistedTranscript.length > 0 || liveTranscript.length > 0) {
      return [...persistedTranscript, ...liveTranscript];
    }
    if (threads.length === 0) return EMPTY_TRANSCRIPT;
    return [];
  }, [liveTranscript, threadItems, threads.length]);

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

  const resolvedProjectsStatus = useMemo(() => ({
    loading: hubReady && projectsQuery.isFetching,
    error: hubReady && projectsQuery.error
      ? errorMessage(projectsQuery.error, 'Hub Projects 加载失败')
      : undefined,
    saving: createProjectMutation.isPending || updateProjectMutation.isPending,
  }), [hubReady, projectsQuery.isFetching, projectsQuery.error, createProjectMutation.isPending, updateProjectMutation.isPending]);

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
        projectId,
        draft: {
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

  const liveModel = {
    activeConversationId,
    ...(activeThread?.projectId ? { activeProjectId: activeThread.projectId } : {}),
    ...(activeThread?.threadId ? { activeThreadId: activeThread.threadId } : {}),
    agents: [],
    ...(resolvedContacts != null ? { contacts: resolvedContacts } : {}),
    ...(resolvedContactsActions != null ? { contactsActions: resolvedContactsActions } : {}),
    conversations,
    dataMode,
    isDemo: false,
    projects: resolvedProjects,
    ...(resolvedProjectsStatus != null ? { projectsStatus: resolvedProjectsStatus } : {}),
    ...(resolvedProjectsActions != null ? { projectsActions: resolvedProjectsActions } : {}),
    transcript,
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
