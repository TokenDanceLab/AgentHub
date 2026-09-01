import type { ProjectDraft, ProjectInfo } from '@agenthub/workbench';
import type { WorkbenchDataMode } from '@shared/demo';
import {
  getWorkbenchDataModeContract,
  isWorkbenchRealDataMode,
  resolveWorkbenchDataMode,
} from '@shared/demo';
import type {
  WorkspaceProject,
  WorkspaceProjectThread,
  WorkspaceProjectThreadMessage,
} from '@/api/hubClient';
import { errorMessage } from './webWorkbenchError';

export function resolveWebWorkbenchProjects(
  projects: WorkspaceProject[] | undefined,
  hubReady: boolean,
  dataMode = resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE),
  projectGroups?: Record<string, WorkspaceProjectGroupProjection | undefined>,
): ProjectInfo[] | undefined {
  if (!hubReady) {
    const contract = getWorkbenchDataModeContract(dataMode);
    return contract.mode === 'mock' || contract.mode === 'fixture' ? undefined : [];
  }
  return (projects ?? []).map((project) => workspaceProjectToProjectInfo(project, projectGroups?.[project.id]));
}

export interface WorkspaceProjectGroupProjection {
  threads: WorkspaceProjectThread[] | WorkspaceProjectGroupListEnvelope<WorkspaceProjectThread>;
  messages: WorkspaceProjectThreadMessage[] | WorkspaceProjectGroupListEnvelope<WorkspaceProjectThreadMessage>;
}

interface WorkspaceProjectGroupListEnvelope<T> {
  items?: T[] | undefined;
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

type WebTranslate = (key: string, options?: any) => string;

export function workspaceProjectToProjectInfo(
  project: WorkspaceProject,
  group?: WorkspaceProjectGroupProjection,
  t?: WebTranslate,
): ProjectInfo {
  const description = project.description?.trim() || 'Hub workspace project';
  const threads = projectGroupItems(group?.threads);
  const messages = projectGroupItems(group?.messages);
  const parsedMessages = messages.map(parseWorkspaceProjectThreadMessageContent);
  const queueRuns = parsedMessages
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- same array length as parsedMessages above
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
    name: project.name?.trim() || t?.('projects.unnamed') || '未命名项目',
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

function projectGroupItems<T>(
  value: T[] | WorkspaceProjectGroupListEnvelope<T> | undefined,
): T[] {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
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

export function projectDraftToHubRequest(draft: ProjectDraft, t?: WebTranslate): { name: string; description: string } {
  return {
    name: draft.name.trim() || t?.('projects.unnamed') || '未命名项目',
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
  t?: WebTranslate,
): { loading: boolean; error?: string | undefined; actionError?: string | undefined; saving: boolean } {
  const realMode = isWorkbenchRealDataMode(dataMode);
  const effectiveRealMode = hubReady || realMode;
  const signedOutRealMode = realMode && !hubReady;
  return {
    loading: effectiveRealMode && (projects.isFetching || selectedProject.isFetching || projectGroups.isFetching),
    error: signedOutRealMode
      ? 'Sign in to Hub to load workspace projects.'
      : effectiveRealMode && projects.error
        ? errorMessage(projects.error, t?.('projects.hubLoadFailed') ?? 'Hub Projects 加载失败')
        : effectiveRealMode && selectedProject.error
          ? errorMessage(selectedProject.error, t?.('projects.hubDetailLoadFailed') ?? 'Hub Project 详情加载失败')
          : effectiveRealMode && projectGroups.error
            ? errorMessage(projectGroups.error, t?.('projects.hubGroupLoadFailed') ?? 'Hub Project Group 加载失败')
        : undefined,
    actionError: effectiveRealMode ? errorMessage(createError ?? updateError, '') || undefined : undefined,
    saving,
  };
}
