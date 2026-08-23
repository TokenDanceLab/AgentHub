import {
  isWorkbenchRealDataMode,
  normalizeWorkbenchDataMode,
  type WorkbenchDataMode,
} from '@shared/demo';
import { appDateLocaleTag } from '@shared/i18n/locale';
import { getI18n } from 'react-i18next';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { AgentInfo } from '@shared/types';
import type { MessageResponse, Session } from '@/api/hubClient';
import {
  webAgents,
  webConversations,
  webHubEmptyConversation,
} from './webPlatformFixtures';

export function agentInfoToWorkbenchAgent(agent: AgentInfo): WorkbenchAgent {
  return {
    id: agent.profileId ?? agent.id,
    name: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    ...(agent.runtimeId ? { icon: agent.runtimeId } : {}),
    status: agent.status,
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.runtimeId ? { runtimeId: agent.runtimeId } : {}),
    ...(agent.provider ? { provider: agent.provider } : {}),
    ...(agent.approvalPolicy ? { approvalPolicy: agent.approvalPolicy } : {}),
    ...(agent.permissionMode ? { permissionMode: agent.permissionMode } : {}),
    ...(agent.reasoningEffort ? { reasoningEffort: agent.reasoningEffort } : {}),
    ...(agent.skills ? { skills: agent.skills } : {}),
    ...(agent.toolAllowlist ? { toolAllowlist: agent.toolAllowlist } : {}),
    ...(agent.targetPreferences ? { targetPreferences: agent.targetPreferences } : {}),
  };
}

export function resolveWebWorkbenchAgents(
  hubAgents: AgentInfo[] | undefined,
  dataMode: WorkbenchDataMode = normalizeWorkbenchDataMode(undefined),
): WorkbenchAgent[] {
  const mapped = hubAgents?.map(agentInfoToWorkbenchAgent) ?? [];
  if (isWorkbenchRealDataMode(dataMode)) return mapped;
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
  const mapped = hubAuthenticated
    ? (sessions
        ?.map(hubSessionToWorkbenchConversation)
        .filter((conversation): conversation is WorkbenchConversation => Boolean(conversation)) ?? [])
    : [];

  if (mapped.length > 0) return mapped;
  if (isWorkbenchRealDataMode(dataMode)) return [webHubEmptyConversation];
  return webConversations;
}

export function formatHubPinTime(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toLocaleTimeString(appDateLocaleTag(getI18n()?.language), {
    hour: '2-digit',
    minute: '2-digit',
  });
}
