import type { QueryClient } from '@tanstack/react-query';
import {
  createWorkbenchDemoStore,
  demoWorkbenchAgents,
  normalizeWorkbenchDataMode,
  resolveDemoWorkbenchTranscript,
  workbenchDemoRuntimeStore,
  type WorkbenchDataMode,
  type WorkbenchDemoRuntimeStore,
} from '@shared/demo';
import type { AgentHubPlatform, WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { ComposerIntent, ComposerSubmitResult } from '@shared/composer';
import type { TranscriptBlock } from '@shared/transcript';
import type { AgentInfo } from '@shared/types';
import { queryClient as defaultQueryClient } from '@/api/queryClient';
import {
  createHubClient,
  type AgentInstance,
  type ExecutionTarget,
  type HubClient,
  type MessageResponse,
  type PendingAgentTask,
  type SendMessageResponse,
} from '@/api/hubClient';
import { selectOnlineLocalEdgeExecutionTarget } from '@/api/executionTargetQueries';
import { getAccessToken } from '@/hooks/useAuth';
import type { Session } from '@/api/hubClient';
import { canOpenWebEvidencePreview, openWebEvidencePreview } from './webPreview';

type WebRunHubClient =
  Pick<HubClient, 'addAgentToSession' | 'sendMessage' | 'triggerAgentTask'> &
  Partial<Pick<HubClient, 'listExecutionTargets'>>;

interface SessionAgentInstanceBinding {
  profileId: string;
  runtimeId: string;
  agentInstance: AgentInstance;
}

export interface WebPlatformOptions {
  hubClient?: WebRunHubClient;
  queryClient?: QueryClient;
  createClientMessageId?: () => string;
  demoRuntimeStore?: WorkbenchDemoRuntimeStore;
  now?: () => string;
  ensureAuth?: () => boolean;
}

const defaultHubClient = createHubClient({ getToken: getAccessToken });
const demoStore = createWorkbenchDemoStore();

export const webConversations: WorkbenchConversation[] = demoStore.conversations;
export const webAgents: WorkbenchAgent[] = demoWorkbenchAgents;
export const webTranscript: TranscriptBlock[] = resolveDemoWorkbenchTranscript('builder');

export const webHubEmptyConversation: WorkbenchConversation = {
  id: 'hub-empty-workspace',
  title: 'Hub 工作台',
  kind: 'group',
  subtitle: '暂无 Hub 会话',
};

export const webHubEmptyTranscript: TranscriptBlock[] = [
  {
    id: 'web-hub-empty',
    kind: 'text',
    author: { id: 'hub', name: 'Hub', role: 'system' },
    text: 'Hub session 已连接，暂无可显示会话。',
  },
];

export function agentInfoToWorkbenchAgent(agent: AgentInfo): WorkbenchAgent {
  return {
    id: agent.profileId ?? agent.id,
    name: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    status: agent.status,
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.runtimeId ? { runtimeId: agent.runtimeId } : {}),
    ...(agent.provider ? { provider: agent.provider } : {}),
    ...(agent.approvalPolicy ? { approvalPolicy: agent.approvalPolicy } : {}),
    ...(agent.permissionMode ? { permissionMode: agent.permissionMode } : {}),
    ...(agent.reasoningEffort ? { reasoningEffort: agent.reasoningEffort } : {}),
    ...(agent.skills ? { skills: agent.skills } : {}),
    ...(agent.toolAllowlist ? { toolAllowlist: agent.toolAllowlist } : {}),
  };
}

export function resolveWebWorkbenchAgents(
  hubAgents: AgentInfo[] | undefined,
  dataMode: WorkbenchDataMode = normalizeWorkbenchDataMode(undefined),
): WorkbenchAgent[] {
  const mapped = hubAgents?.map(agentInfoToWorkbenchAgent) ?? [];
  if (dataMode === 'real') return mapped;
  return mapped.length > 0 ? mapped : webAgents;
}

export function hubSessionToWorkbenchConversation(session: Session): WorkbenchConversation | null {
  const id = session.id ?? session.session_id;
  if (!id) return null;
  const isPrivate = session.type === 'private';
  const fallbackTitle = isPrivate ? 'Hub 私聊' : 'Hub 群聊';

  return {
    id,
    title: session.name?.trim() || fallbackTitle,
    kind: isPrivate ? 'direct' : 'group',
    subtitle: session.member_count != null
      ? `Hub ${session.type} · ${session.member_count} members`
      : `Hub ${session.type}`,
    ...(session.unread_count ? { unreadCount: session.unread_count } : {}),
  };
}

export function webConversationWithPinnedMessages(
  conversation: WorkbenchConversation,
  pins: MessageResponse[] | undefined,
): WorkbenchConversation {
  const firstPin = pins?.[0];
  if (!firstPin) {
    const { pinnedAnnouncement: _removed, ...withoutPin } = conversation;
    return withoutPin;
  }

  const pinnedTime = formatHubPinTime(firstPin.created_at);
  return {
    ...conversation,
    pinnedAnnouncement: {
      title: conversation.title,
      content: firstPin.content,
      author: firstPin.sender_id || 'Hub',
      ...(pinnedTime ? { time: pinnedTime } : {}),
      sourceId: firstPin.id,
    },
  };
}

export function resolveWebWorkbenchConversations(
  sessions: Session[] | undefined,
  hubAuthenticated: boolean,
  dataMode: WorkbenchDataMode = normalizeWorkbenchDataMode(undefined),
): WorkbenchConversation[] {
  if (!hubAuthenticated) return dataMode === 'real' ? [webHubEmptyConversation] : webConversations;

  const mapped = sessions
    ?.map(hubSessionToWorkbenchConversation)
    .filter((conversation): conversation is WorkbenchConversation => Boolean(conversation)) ?? [];
  return mapped.length > 0 ? mapped : [webHubEmptyConversation];
}

function formatHubPinTime(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function createWebPlatform(options: WebPlatformOptions = {}): AgentHubPlatform {
  const hubClient = options.hubClient ?? defaultHubClient;
  const hasInjectedHubClient = Boolean(options.hubClient);
  const queryClient = options.queryClient ?? defaultQueryClient;
  const createClientMessageId = options.createClientMessageId ?? newClientMessageId;
  const demoRuntimeStore = options.demoRuntimeStore ?? workbenchDemoRuntimeStore;
  const now = options.now ?? (() => new Date().toISOString());
  const ensureAuth = options.ensureAuth;

  return {
    surface: 'web',
    capabilities: {
      localEdge: false,
      localFiles: false,
      browserPreview: true,
    },
    conversations: {
      async list(): Promise<WorkbenchConversation[]> {
        return webConversations;
      },
    },
    preview: {
      canOpenEvidence: canOpenWebEvidencePreview,
      openEvidence: openWebEvidencePreview,
    },
    runs: {
      async submitComposerIntent(intent: ComposerIntent): Promise<ComposerSubmitResult> {
        const dataMode = normalizeWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE);
        const hasHubToken = Boolean(getAccessToken());
        const shouldUseDemoFallback = dataMode === 'demo' || (
          dataMode === 'auto' &&
          !hasInjectedHubClient &&
          !hasHubToken &&
          !ensureAuth
        );
        if (shouldUseDemoFallback) {
          return demoRuntimeStore.submitComposerIntent(intent);
        }
        if (!hasHubToken && ensureAuth && !ensureAuth()) {
          throw new Error('Hub authentication is required before Web can submit real Hub work.');
        }
        return submitWebComposerIntent(hubClient, createClientMessageId, intent, { queryClient, now });
      },
    },
  };
}

export interface SubmitWebComposerIntentOptions {
  queryClient?: QueryClient;
  now?: () => string;
}

export async function submitWebComposerIntent(
  hubClient: WebRunHubClient,
  createClientMessageId: () => string,
  intent: ComposerIntent,
  options: SubmitWebComposerIntentOptions = {},
): Promise<ComposerSubmitResult> {
  const mention = intent.mentions[0];
  if (mention && !mention.runtimeId) {
    throw new Error(`Mentioned Hub agent "${mention.label}" is missing a runtime id.`);
  }
  const agentInstance = mention
    ? await ensureMentionedAgentInstance(hubClient, intent.conversationId, mention, options.queryClient)
    : undefined;

  const clientMessageId = createClientMessageId();
  const optimisticMessage = optimisticHubMessageFromIntent(intent, clientMessageId, options.now?.() ?? new Date().toISOString());
  upsertHubMessage(options.queryClient, optimisticMessage);

  let message: SendMessageResponse;
  try {
    message = await sendComposerMessage(hubClient, clientMessageId, intent);
    confirmOptimisticHubMessage(options.queryClient, intent.conversationId, clientMessageId, message);
  } catch (error) {
    removeOptimisticHubMessage(options.queryClient, intent.conversationId, clientMessageId);
    throw error;
  }

  if (!mention) {
    return { intentId: message.message_id };
  }

  const task = await triggerMentionedAgent(hubClient, message.message_id, agentInstance?.id, intent);
  return { intentId: task.id || message.message_id };
}

async function sendComposerMessage(
  hubClient: WebRunHubClient,
  clientMessageId: string,
  intent: ComposerIntent,
): Promise<SendMessageResponse> {
  return hubClient.sendMessage(intent.conversationId, {
    client_msg_id: clientMessageId,
    content_type: 'text',
    content: buildHubComposerPrompt(intent),
  });
}

export function optimisticHubMessageFromIntent(
  intent: ComposerIntent,
  clientMessageId: string,
  createdAt: string,
): MessageResponse {
  return {
    id: clientMessageId,
    session_id: intent.conversationId,
    seq_id: Number.MAX_SAFE_INTEGER,
    client_msg_id: clientMessageId,
    sender_type: 'user',
    sender_id: 'web-current-user',
    content_type: 'text',
    content: buildHubComposerPrompt(intent),
    created_at: createdAt,
  };
}

export function upsertHubMessage(
  queryClient: QueryClient | undefined,
  message: MessageResponse,
): void {
  queryClient?.setQueryData<MessageResponse[]>(
    hubMessagesQueryKey(message.session_id),
    (current = []) => [
      ...current.filter((item) => item.client_msg_id !== message.client_msg_id && item.id !== message.id),
      message,
    ],
  );
}

export function confirmOptimisticHubMessage(
  queryClient: QueryClient | undefined,
  sessionId: string,
  clientMessageId: string,
  response: SendMessageResponse,
): void {
  queryClient?.setQueryData<MessageResponse[]>(
    hubMessagesQueryKey(sessionId),
    (current = []) => current.map((message) =>
      message.client_msg_id === clientMessageId
        ? {
            ...message,
            id: response.message_id,
            seq_id: response.seq_id,
            created_at: response.created_at,
          }
        : message,
    ),
  );
}

export function removeOptimisticHubMessage(
  queryClient: QueryClient | undefined,
  sessionId: string,
  clientMessageId: string,
): void {
  queryClient?.setQueryData<MessageResponse[]>(
    hubMessagesQueryKey(sessionId),
    (current = []) => current.filter((message) => message.client_msg_id !== clientMessageId),
  );
}

function hubMessagesQueryKey(sessionId: string): [string, string, string] {
  return ['web-v4', 'hub-messages', sessionId];
}

function sessionAgentBindingsQueryKey(sessionId: string): [string, string, string] {
  return ['web-v4', 'session-agent-instances', sessionId];
}

async function ensureMentionedAgentInstance(
  hubClient: WebRunHubClient,
  sessionId: string,
  mention: ComposerIntent['mentions'][number],
  queryClient: QueryClient | undefined,
): Promise<AgentInstance> {
  const runtimeId = mention.runtimeId?.trim();
  if (!runtimeId) {
    throw new Error(`Mentioned Hub agent "${mention.label}" is missing a runtime id.`);
  }

  const cached = queryClient
    ?.getQueryData<SessionAgentInstanceBinding[]>(sessionAgentBindingsQueryKey(sessionId))
    ?.find((binding) => binding.profileId === mention.id && binding.runtimeId === runtimeId);
  if (cached?.agentInstance.id) {
    return cached.agentInstance;
  }

  const agentInstance = await hubClient.addAgentToSession(sessionId, {
    agent_type: runtimeId,
    display_name: mention.label,
  });
  if (!agentInstance?.id) {
    throw new Error(`Hub did not return an agent instance id for "${mention.label}".`);
  }

  upsertSessionAgentBinding(queryClient, sessionId, {
    profileId: mention.id,
    runtimeId,
    agentInstance,
  });
  return agentInstance;
}

function upsertSessionAgentBinding(
  queryClient: QueryClient | undefined,
  sessionId: string,
  binding: SessionAgentInstanceBinding,
): void {
  queryClient?.setQueryData<SessionAgentInstanceBinding[]>(
    sessionAgentBindingsQueryKey(sessionId),
    (current = []) => [
      ...current.filter((item) => item.profileId !== binding.profileId || item.runtimeId !== binding.runtimeId),
      binding,
    ],
  );
}

async function triggerMentionedAgent(
  hubClient: WebRunHubClient,
  triggerMessageId: string,
  agentInstanceId: string | undefined,
  intent: ComposerIntent,
): Promise<PendingAgentTask> {
  if (!agentInstanceId) {
    throw new Error('Hub did not return an exact agent instance id for dispatch.');
  }
  const target = await resolveWebDispatchTarget(hubClient);
  return hubClient.triggerAgentTask(triggerMessageId, {
    agent_instance_id: agentInstanceId,
    target_id: target.id,
    model_params: JSON.stringify(buildHubAgentTaskModelParams(intent)),
  });
}

async function resolveWebDispatchTarget(hubClient: WebRunHubClient): Promise<Pick<ExecutionTarget, 'id'>> {
  if (!hubClient.listExecutionTargets) {
    throw new Error('Hub execution target inventory is required for Web Hub dispatch.');
  }
  const inventory = await hubClient.listExecutionTargets({
    target_type: 'local_edge',
    pageSize: 50,
  });
  const target = selectOnlineLocalEdgeExecutionTarget(inventory.items);
  if (!target?.id) {
    throw new Error('No online local_edge execution target is available for Web Hub dispatch.');
  }
  return target;
}

function buildHubComposerPrompt(intent: ComposerIntent): string {
  const lines = [intent.text.trim()];
  const attachmentContext = intent.attachments
    .filter((attachment) => attachment.contentPreview?.trim())
    .map((attachment) => {
      const source = attachment.source ? ` (${attachment.source})` : '';
      return `### ${attachment.name}${source}\n${attachment.contentPreview}`;
    });

  if (attachmentContext.length > 0) {
    lines.push('[AgentHub attachments]', attachmentContext.join('\n\n'));
  }

  return lines.filter(Boolean).join('\n\n');
}

function buildHubAgentTaskModelParams(intent: ComposerIntent): Record<string, unknown> {
  return {
    source: 'web-v4-workbench',
    mode: intent.mode,
    approval_mode: intent.approvalMode,
    ...(intent.workDir ? { work_dir: intent.workDir } : {}),
    mentions: intent.mentions.map((mention) => ({
      id: mention.id,
      label: mention.label,
      ...(mention.runtimeId ? { runtime_id: mention.runtimeId } : {}),
      ...(mention.model ? { model: mention.model } : {}),
    })),
    attachments: intent.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      ...(attachment.source ? { source: attachment.source } : {}),
      ...(attachment.kind ? { kind: attachment.kind } : {}),
      ...(attachment.mime ? { mime: attachment.mime } : {}),
      ...(attachment.truncated != null ? { truncated: attachment.truncated } : {}),
    })),
  };
}

function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-v4-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
