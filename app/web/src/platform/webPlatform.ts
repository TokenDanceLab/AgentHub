import type { AgentHubPlatform, WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { ComposerIntent, ComposerSubmitResult } from '@shared/composer';
import type { TranscriptBlock } from '@shared/transcript';
import type { AgentInfo } from '@shared/types';
import { createHubClient, type HubClient, type PendingAgentTask, type SendMessageResponse } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import type { Session } from '@/api/hubClient';
import { canOpenWebEvidencePreview, openWebEvidencePreview } from './webPreview';

type WebRunHubClient = Pick<HubClient, 'sendMessage' | 'triggerAgentTask'>;

export interface WebPlatformOptions {
  hubClient?: WebRunHubClient;
  createClientMessageId?: () => string;
}

const defaultHubClient = createHubClient({ getToken: getAccessToken });

export const webConversations: WorkbenchConversation[] = [
  {
    id: 'agent-collab',
    title: 'Agent 协作群',
    kind: 'group',
    subtitle: '共享 v4 Web 工作台',
    unreadCount: 2,
  },
  {
    id: 'builder',
    title: 'Builder',
    kind: 'direct',
    subtitle: 'Claude Code',
  },
];

export const webAgents: WorkbenchAgent[] = [
  {
    id: 'builder',
    name: 'Builder',
    description: 'Web v4 代码实现',
    status: 'available',
    model: 'glm-5.1',
    runtimeId: 'claude-code',
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: '架构和文档复核',
    status: 'available',
    model: 'deepseek-v4-pro',
    runtimeId: 'claude-code',
  },
];

export const webTranscript: TranscriptBlock[] = [
  {
    id: 'web-msg-1',
    kind: 'text',
    author: { id: 'system', name: 'AgentHub', role: 'system' },
    text: 'Web 已接入 shared v4 workbench。',
  },
  {
    id: 'web-tool-1',
    kind: 'tool_call',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    toolName: 'AgentHubWorkbench',
    status: 'completed',
    evidenceRefs: [
      { id: 'web-shared-workbench', kind: 'artifact', label: 'shared v4 workbench', status: 'completed' },
    ],
  },
];

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
  };
}

export function resolveWebWorkbenchAgents(hubAgents: AgentInfo[] | undefined): WorkbenchAgent[] {
  const mapped = hubAgents?.map(agentInfoToWorkbenchAgent) ?? [];
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

export function resolveWebWorkbenchConversations(
  sessions: Session[] | undefined,
  hubAuthenticated: boolean,
): WorkbenchConversation[] {
  if (!hubAuthenticated) return webConversations;

  const mapped = sessions
    ?.map(hubSessionToWorkbenchConversation)
    .filter((conversation): conversation is WorkbenchConversation => Boolean(conversation)) ?? [];
  return mapped.length > 0 ? mapped : [webHubEmptyConversation];
}

export function createWebPlatform(options: WebPlatformOptions = {}): AgentHubPlatform {
  const hubClient = options.hubClient ?? defaultHubClient;
  const createClientMessageId = options.createClientMessageId ?? newClientMessageId;

  return {
    surface: 'web',
    capabilities: {
      localEdge: false,
      localFiles: false,
      browserPreview: false,
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
        return submitWebComposerIntent(hubClient, createClientMessageId, intent);
      },
    },
  };
}

export async function submitWebComposerIntent(
  hubClient: WebRunHubClient,
  createClientMessageId: () => string,
  intent: ComposerIntent,
): Promise<ComposerSubmitResult> {
  const mention = intent.mentions[0];
  if (mention && !mention.runtimeId) {
    throw new Error(`Mentioned Hub agent "${mention.label}" is missing a runtime id.`);
  }

  const message = await sendComposerMessage(hubClient, createClientMessageId, intent);
  if (!mention) {
    return { intentId: message.message_id };
  }

  const task = await triggerMentionedAgent(hubClient, message.message_id, intent);
  return { intentId: task.id || message.message_id };
}

async function sendComposerMessage(
  hubClient: WebRunHubClient,
  createClientMessageId: () => string,
  intent: ComposerIntent,
): Promise<SendMessageResponse> {
  return hubClient.sendMessage(intent.conversationId, {
    client_msg_id: createClientMessageId(),
    content_type: 'text',
    content: buildHubComposerPrompt(intent),
  });
}

async function triggerMentionedAgent(
  hubClient: WebRunHubClient,
  triggerMessageId: string,
  intent: ComposerIntent,
): Promise<PendingAgentTask> {
  const mention = intent.mentions[0];
  return hubClient.triggerAgentTask(triggerMessageId, {
    ...(mention?.runtimeId ? { agent_type: mention.runtimeId } : {}),
    model_params: JSON.stringify(buildHubAgentTaskModelParams(intent)),
  });
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
