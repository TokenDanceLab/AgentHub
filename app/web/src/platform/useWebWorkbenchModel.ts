import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactMember, ProjectDraft, ProjectInfo, WorkbenchContactsData } from '@shared/workbench';
import type { WorkbenchDataMode } from '@shared/demo';
import {
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  getWorkbenchDataModeOverrideSnapshot,
  resolveWorkbenchDataMode,
  resolveDemoWorkbenchTranscript,
  subscribeWorkbenchDataModeOverride,
  workbenchDemoRuntimeStore,
} from '@shared/demo';
import {
  normalizeHubMessagesToTranscript,
  normalizeHubRuntimeEventsToTranscript,
  type HubMessageTranscriptInput,
  type HubRuntimeEventTranscriptInput,
  type TranscriptBlock,
} from '@shared/transcript';
import { createHubClient } from '@/api/hubClient';
import type { ContactInfo, WorkspaceProject } from '@/api/hubClient';
import { selectOnlineLocalEdgeExecutionTarget, useHubExecutionTargets } from '@/api/executionTargetQueries';
import type { ExecutionTargetInventoryItem } from '@/api/executionTargetQueries';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import {
  resolveWebWorkbenchConversations,
  webConversationWithPinnedMessages,
  webHubEmptyTranscript,
} from './webPlatform';
import { useWebHubRealtime } from './webHubRealtime';

const hubClient = createHubClient({ getToken: getAccessToken });

export function useWebWorkbenchModel(selectedConversationId?: string) {
  const dataModeOverride = useSyncExternalStore(
    subscribeWorkbenchDataModeOverride,
    getWorkbenchDataModeOverrideSnapshot,
    getWorkbenchDataModeOverrideSnapshot,
  );
  const dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE, dataModeOverride || undefined);
  const authenticated = useHubStore((state) => state.authenticated);
  const hubReady = dataMode !== 'demo' && authenticated && Boolean(getAccessToken());
  const queryClient = useQueryClient();
  const demoSnapshot = useSyncExternalStore(
    workbenchDemoRuntimeStore.subscribe,
    workbenchDemoRuntimeStore.getSnapshot,
    workbenchDemoRuntimeStore.getSnapshot,
  );
  const [liveRuntimeEvents, setLiveRuntimeEvents] = useState<HubRuntimeEventTranscriptInput[]>([]);

  const sessions = useQuery({
    queryKey: ['web-v4', 'hub-sessions', hubReady],
    queryFn: () => hubClient.listSessions(),
    enabled: hubReady,
    refetchInterval: hubReady ? 10_000 : false,
    placeholderData: (previous) => previous,
  });

  const conversations = !hubReady && dataMode !== 'real'
    ? demoSnapshot.conversations
    : resolveWebWorkbenchConversations(sessions.data, hubReady, dataMode);
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

  useWebHubRealtime({
    enabled: hubReady,
    runtimeSessionId: activeHubSessionId,
    onRuntimeEvent: appendLiveRuntimeEvent,
  });

  const messages = useQuery({
    queryKey: ['web-v4', 'hub-messages', activeHubSessionId],
    queryFn: () => hubClient.getMessages(activeHubSessionId!, { limit: 80 }),
    enabled: Boolean(activeHubSessionId),
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

  const projects = useQuery({
    queryKey: ['web-v4', 'hub-projects', hubReady],
    queryFn: () => hubClient.listWorkspaceProjects({ pageSize: 50 }),
    enabled: hubReady,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
  const createProject = useMutation({
    mutationFn: (draft: ProjectDraft) => hubClient.createWorkspaceProject(projectDraftToHubRequest(draft)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-projects'] });
    },
  });
  const updateProject = useMutation({
    mutationFn: ({ projectId, draft }: { projectId: string; draft: ProjectDraft }) =>
      hubClient.updateWorkspaceProject(projectId, projectDraftToHubRequest(draft)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-projects'] });
    },
  });
  const executionTargets = useHubExecutionTargets({ enabled: hubReady });
  const onlineLocalEdgeTargets = (executionTargets.data?.items ?? []).filter((target) =>
    target.target_type === 'local_edge' &&
    target.is_online === true &&
    target.health_state !== 'offline'
  );
  const composerExecutionTargets = hubReady || dataMode === 'real'
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

  const transcript = !hubReady && dataMode !== 'real'
    ? workbenchDemoRuntimeStore.resolveTranscript(activeConversationId)
    : resolveWebWorkbenchTranscript(
      hubReady,
      activeHubSessionId,
      messages.data,
      liveRuntimeEvents,
      dataMode,
    );
  const surfacedTranscript = executionTargetStatus.block
    ? [executionTargetStatus.block, ...transcript]
    : transcript;

  return {
    activeConversationId,
    contacts: resolveWebWorkbenchContacts(contacts.data, hubReady, dataMode),
    conversations: resolvedConversations,
    composerExecutionTargets,
    projects: resolveWebWorkbenchProjects(projects.data?.items, hubReady, dataMode),
    projectsStatus: resolveWebProjectsStatus(
      { isFetching: projects.isFetching, error: projects.error },
      createProject.error,
      updateProject.error,
      hubReady,
      dataMode,
      createProject.isPending || updateProject.isPending,
    ),
    projectsActions: hubReady ? {
      create: async (draft: ProjectDraft) => workspaceProjectToProjectInfo(await createProject.mutateAsync(draft)),
      update: async (projectId: string, draft: ProjectDraft) => (
        workspaceProjectToProjectInfo(await updateProject.mutateAsync({ projectId, draft }))
      ),
    } : undefined,
    transcript: surfacedTranscript,
  };
}

const webHubEmptyContacts: WorkbenchContactsData = {
  members: [],
  externalContacts: [],
  pendingContacts: [],
  starredContacts: [],
  groups: [],
  recentShortcuts: [],
  orgName: 'TokenDance',
  orgInitials: 'TD',
};

function contactInfoToMember(contact: ContactInfo): ContactMember {
  const displayName = contact.remark?.trim() || contact.nickname?.trim() || contact.username || contact.user_id;
  return {
    id: contact.user_id,
    name: displayName,
    initials: contactInitials(displayName),
    org: contact.type === 'external' ? '外部联系人' : 'TokenDance',
    status: contact.online ? '在线' : '离线',
    tag: contact.type === 'external' ? 'External' : 'Hub',
  };
}

export function resolveWebWorkbenchContacts(
  contacts: ContactInfo[] | undefined,
  hubReady: boolean,
  dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE),
): WorkbenchContactsData | undefined {
  if (!hubReady) {
    return dataMode === 'real' ? webHubEmptyContacts : undefined;
  }
  const members = contacts?.map(contactInfoToMember) ?? [];
  return {
    ...webHubEmptyContacts,
    members,
    starredContacts: members.slice(0, 2),
    recentShortcuts: members.slice(0, 3).map((member) => member.name),
  };
}

export function resolveWebWorkbenchProjects(
  projects: WorkspaceProject[] | undefined,
  hubReady: boolean,
  dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE),
): ProjectInfo[] | undefined {
  if (!hubReady) {
    return dataMode === 'demo' ? undefined : [];
  }
  return (projects ?? []).map(workspaceProjectToProjectInfo);
}

export function workspaceProjectToProjectInfo(project: WorkspaceProject): ProjectInfo {
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
): { loading: boolean; error?: string | undefined; actionError?: string | undefined; saving: boolean } {
  const effectiveRealMode = hubReady || dataMode === 'real';
  return {
    loading: effectiveRealMode && projects.isFetching,
    error: effectiveRealMode && projects.error ? errorMessage(projects.error, 'Hub Projects 加载失败') : undefined,
    actionError: effectiveRealMode ? errorMessage(createError ?? updateError, '') || undefined : undefined,
    saving,
  };
}

export type WebExecutionTargetStatusState = 'hidden' | 'signed-out' | 'loading' | 'error' | 'empty' | 'ready';

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
  const visibleRealMode = input.hubReady || input.dataMode === 'real';
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

  const selectedTarget = selectOnlineLocalEdgeExecutionTarget(input.targets ?? []) as ExecutionTargetInventoryItem | undefined;
  if (!selectedTarget) {
    return targetStatus(
      'empty',
      'No online local_edge execution target is available. Web real Hub mode will not dispatch agent tasks to mock targets.',
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

function contactInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'U';
  const chars = Array.from(trimmed);
  const asciiWords = trimmed.match(/[A-Za-z0-9]+/g);
  if (asciiWords && asciiWords.length > 0) {
    return asciiWords
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || 'U';
  }
  return chars.slice(0, 2).join('').toUpperCase();
}

export function resolveWebWorkbenchTranscript(
  hubReady: boolean,
  activeHubSessionId: string | null,
  messages: HubMessageTranscriptInput[] | undefined,
  liveRuntimeEvents: HubRuntimeEventTranscriptInput[],
  dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE),
): TranscriptBlock[] {
  if (!hubReady) {
    return dataMode === 'real'
      ? webHubEmptyTranscript
      : resolveDemoWorkbenchTranscript(WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID);
  }
  if (!activeHubSessionId) return webHubEmptyTranscript;
  return [
    ...normalizeHubMessagesToTranscript(messages),
    ...normalizeHubRuntimeEventsToTranscript(liveRuntimeEvents),
  ];
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

function hubRuntimeEventKey(event: HubRuntimeEventTranscriptInput): string {
  return event.id ?? [
    event.task_id,
    event.edge_run_id,
    event.event_seq,
    event.event_type,
  ].filter((part) => part != null && String(part).trim()).join(':');
}
