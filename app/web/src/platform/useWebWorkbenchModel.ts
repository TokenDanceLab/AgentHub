import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactMember, ProjectDraft, ProjectInfo, WorkbenchContactsData } from '@shared/workbench';
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
import { useHubExecutionTargets } from '@/api/executionTargetQueries';
import type { ExecutionTargetInventoryItem } from '@/api/executionTargetQueries';
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

  const conversations = !hubReady && !realMode
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
  const selectedProjectDetailId = hubReady
    ? selectedProjectId ?? projects.data?.items[0]?.id
    : undefined;
  const selectedProject = useQuery({
    queryKey: ['web-v4', 'hub-project', selectedProjectDetailId],
    queryFn: () => hubClient.getWorkspaceProject(selectedProjectDetailId!),
    enabled: Boolean(selectedProjectDetailId),
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
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-projects'] });
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-project', variables.projectId] });
    },
  });
  const executionTargets = useHubExecutionTargets({ enabled: hubReady });
  const onlineLocalEdgeTargets = (executionTargets.data?.items ?? []).filter((target) =>
    target.target_type === 'local_edge' &&
    target.is_online === true &&
    target.health_state === 'healthy'
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

  const transcript = !hubReady && !realMode
    ? workbenchDemoRuntimeStore.resolveTranscript(activeConversationId)
    : resolveWebWorkbenchTranscript(
      hubReady,
      activeHubSessionId,
      messages.data,
      mergeHubRuntimeEvents(replayedRuntimeEvents.data, liveRuntimeEvents),
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
    projects: resolveWebWorkbenchProjects(
      mergeWorkspaceProjectDetail(projects.data?.items, selectedProject.data),
      hubReady,
      dataMode,
    ),
    projectsStatus: resolveWebProjectsStatus(
      { isFetching: projects.isFetching, error: projects.error },
      createProject.error,
      updateProject.error,
      hubReady,
      dataMode,
      createProject.isPending || updateProject.isPending,
      { isFetching: selectedProject.isFetching, error: selectedProject.error },
    ),
    projectsActions: hubReady ? {
      create: async (draft: ProjectDraft) => workspaceProjectToProjectInfo(await createProject.mutateAsync(draft)),
      update: async (projectId: string, draft: ProjectDraft) => (
        workspaceProjectToProjectInfo(await updateProject.mutateAsync({ projectId, draft }))
      ),
    } : undefined,
    workbenchStatus: {
      dataMode: workbenchDataModeLabel(dataMode),
      targetState: executionTargetStatus.state,
      targetLabel: executionTargetStatus.selectedTarget
        ? executionTargetLabel(executionTargetStatus.selectedTarget)
        : undefined,
      replayLabel: activeHubSessionId
        ? activeAgentTaskId
          ? `Hub replay: task ${activeAgentTaskId} · ${activeAgentTaskSummary.data?.total_events ?? mergeHubRuntimeEvents(replayedRuntimeEvents.data, liveRuntimeEvents).length} runtime event${(activeAgentTaskSummary.data?.total_events ?? mergeHubRuntimeEvents(replayedRuntimeEvents.data, liveRuntimeEvents).length) === 1 ? '' : 's'} observed`
          : `Hub replay: ${liveRuntimeEvents.length} runtime event${liveRuntimeEvents.length === 1 ? '' : 's'} observed`
        : realMode
          ? 'Hub replay: no active Hub session'
          : 'Fixture replay: shared demo transcript',
    },
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
    return isWorkbenchRealDataMode(dataMode) ? webHubEmptyContacts : undefined;
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
    return isWorkbenchFixtureDataMode(dataMode) ? undefined : [];
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
): { loading: boolean; error?: string | undefined; actionError?: string | undefined; saving: boolean } {
  const realMode = isWorkbenchRealDataMode(dataMode);
  const effectiveRealMode = hubReady || realMode;
  const signedOutRealMode = realMode && !hubReady;
  return {
    loading: effectiveRealMode && (projects.isFetching || selectedProject.isFetching),
    error: signedOutRealMode
      ? 'Sign in to Hub to load workspace projects.'
      : effectiveRealMode && projects.error
        ? errorMessage(projects.error, 'Hub Projects 加载失败')
        : effectiveRealMode && selectedProject.error
          ? errorMessage(selectedProject.error, 'Hub Project 详情加载失败')
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
    target.is_online === true && target.health_state === 'healthy'
  );
  if (!selectedTarget) {
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
    return isWorkbenchRealDataMode(dataMode)
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
