import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import type { GlobalRailPage } from './GlobalRail';
import { WORKBENCH_MOCK_AGENT_CONFIGS, WORKBENCH_MOCK_CONTACT_MEMBERS } from './mockData';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchProfileChromeHelpers — pure residual slices from
   useWorkbenchProfileChrome (#709).

   Public option/return types, profile state shapes, configured catalog
   projection, agent/human/group profile resolution, conversation-avatar
   open plans, DM open plans, and profile-link builders.
   No React hooks / no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined,
   unless the public field type explicitly allows `| undefined`.
   ═══════════════════════════════════════════════════════════════════════ */

export type ProfileChromeTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export interface AgentProfileState {
  id: string;
  name: string;
  role: string;
  engine: string;
  model: string;
  state: string;
  skills: string[];
  anchor: HTMLElement;
}

export interface HumanProfileState {
  id: string;
  name: string;
  initials: string;
  org: string;
  status: string;
  tag: string;
  subtitle: string;
  avatarColor?: string | undefined;
  anchor: HTMLElement;
}

export interface GroupProfileState {
  id: string;
  name: string;
  memberNames: string[];
  anchor: HTMLElement;
}

export interface ConfiguredAgentProfileInput {
  id: string;
  name: string;
  role: string;
  engine: string;
  model: string;
  state: string;
  skills: string[];
}

export interface UseWorkbenchProfileChromeOptions {
  agents?: WorkbenchAgent[] | undefined;
  conversations: WorkbenchConversation[];
  t: ProfileChromeTranslate;
  selectConversation: (conversationId: string) => void;
  setActivePage: Dispatch<SetStateAction<GlobalRailPage>>;
  showWorkbenchToast: (message: string) => void;
  copyText: (text: string) => void;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  onNavigateToConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
}

export interface WorkbenchProfileChrome {
  activeAgentProfile: AgentProfileState | null;
  activeHumanProfile: HumanProfileState | null;
  activeGroupProfile: GroupProfileState | null;
  focusedAgentId: string | undefined;
  setActiveAgentProfile: Dispatch<SetStateAction<AgentProfileState | null>>;
  setActiveHumanProfile: Dispatch<SetStateAction<HumanProfileState | null>>;
  setActiveGroupProfile: Dispatch<SetStateAction<GroupProfileState | null>>;
  openAgentProfile: (agentName: string, anchor: HTMLElement) => void;
  openAgentProfileFromConfig: (
    agent: ConfiguredAgentProfileInput,
    anchor: HTMLElement,
  ) => void;
  openConversationAvatar: (conversation: WorkbenchConversation, anchor: HTMLElement) => void;
  openAgentDirectMessage: () => void;
  openHumanDirectMessage: () => void;
  openAgentConfig: () => void;
  openGroupConversation: () => void;
  copyHumanProfileLink: () => void;
}

export type ConversationAvatarOpenPlan =
  | { kind: 'group'; profile: GroupProfileState }
  | { kind: 'agent'; profile: AgentProfileState }
  | { kind: 'human'; profile: HumanProfileState };

export type DirectMessageOpenPlan =
  | { kind: 'select'; conversationId: string }
  | { kind: 'navigate'; target: { name: string; id: string; kind: 'dm' } }
  | { kind: 'toast'; name: string };

/** Project mock agent configs into anchor-free profile rows. */
export function configuredAgentProfiles(): Array<Omit<AgentProfileState, 'anchor'>> {
  return WORKBENCH_MOCK_AGENT_CONFIGS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    engine: agent.engine,
    model: agent.model,
    state: agent.state,
    skills: agent.skills,
  }));
}

/** Localized badge label for an agent runtime state. */
export function agentStateLabel(t: (key: string) => string, state: string): string {
  switch (state) {
    case 'running':
      return t('agent.state.running');
    case 'ready':
    case 'available':
      return t('agent.state.ready');
    case 'waiting':
      return t('agent.state.waiting');
    case 'configuring':
      return t('agent.state.configuring');
    case 'unavailable':
      return t('agent.state.unavailable');
    default:
      return state || t('label.agent');
  }
}

/** Case-insensitive id/name match used by profile + conversation lookups. */
export function matchesProfileIdentity(
  candidate: { id: string; name?: string | undefined; title?: string | undefined },
  profile: { id: string; name: string },
): boolean {
  const normalizedName = profile.name.toLowerCase();
  const normalizedId = profile.id.toLowerCase();
  const candidateName = (candidate.name ?? candidate.title ?? '').toLowerCase();
  return candidateName === normalizedName || candidate.id.toLowerCase() === normalizedId;
}

/** Resolve a configured or runtime agent profile by display name / id. */
export function resolveAgentProfileByName(input: {
  agentName: string;
  agents?: WorkbenchAgent[] | undefined;
  t: ProfileChromeTranslate;
}): Omit<AgentProfileState, 'anchor'> | null {
  const normalized = input.agentName.toLowerCase();
  const runtimeAgent = (input.agents ?? []).find((agent) => agent.name.toLowerCase() === normalized);
  const configured = configuredAgentProfiles().find((agent) => (
    agent.name.toLowerCase() === normalized || agent.id.toLowerCase() === normalized
  ));

  if (configured) return configured;
  if (!runtimeAgent) return null;

  return {
    id: runtimeAgent.id,
    name: runtimeAgent.name,
    role: runtimeAgent.description ?? input.t('label.agent'),
    engine: input.t('label.agentHub'),
    model: runtimeAgent.model ?? input.t('status.unconfigured'),
    state: runtimeAgent.status ?? 'available',
    skills: [],
  };
}

/** Resolve a human profile from mock contacts + conversation metadata. */
export function resolveHumanProfileByName(input: {
  name: string;
  conversations: WorkbenchConversation[];
  t: ProfileChromeTranslate;
  anchor: HTMLElement;
}): HumanProfileState {
  const normalized = input.name.toLowerCase();
  const contact = WORKBENCH_MOCK_CONTACT_MEMBERS.find((item) => (
    item.name.toLowerCase() === normalized || item.id.toLowerCase() === normalized
  ));
  const conversation = input.conversations.find((item) => (
    item.title.toLowerCase() === normalized || item.id.toLowerCase() === normalized
  ));
  const resolvedName = contact?.name ?? conversation?.title ?? input.name;

  return {
    id: contact?.id ?? conversation?.id ?? resolvedName.toLowerCase(),
    name: resolvedName,
    initials: contact?.initials ?? conversation?.avatarLabel ?? resolvedName.slice(0, 1).toUpperCase(),
    org: contact?.org ?? input.t('label.contact'),
    status: contact?.status ?? conversation?.updatedLabel ?? input.t('status.online'),
    tag: contact?.tag ?? (conversation?.kind === 'group' ? input.t('chat.kind.group') : input.t('chat.kind.friend')),
    subtitle: conversation?.subtitle ?? contact?.org ?? input.t('chat.kind.friend'),
    avatarColor: conversation?.avatarColor,
    anchor: input.anchor,
  };
}

export function attachAgentProfileAnchor(
  profile: Omit<AgentProfileState, 'anchor'>,
  anchor: HTMLElement,
): AgentProfileState {
  return { ...profile, anchor };
}

export function buildAgentProfileFromConfig(
  agent: ConfiguredAgentProfileInput,
  anchor: HTMLElement,
): AgentProfileState {
  return { ...agent, anchor };
}

export function buildGroupProfileFromConversation(
  conversation: WorkbenchConversation,
  anchor: HTMLElement,
): GroupProfileState {
  return {
    id: conversation.id,
    name: conversation.title,
    memberNames: conversation.members ?? [],
    anchor,
  };
}

/** Pure open plan for a conversation avatar click. */
export function planConversationAvatarOpen(input: {
  conversation: WorkbenchConversation;
  conversations: WorkbenchConversation[];
  anchor: HTMLElement;
  agents?: WorkbenchAgent[] | undefined;
  t: ProfileChromeTranslate;
}): ConversationAvatarOpenPlan {
  if (input.conversation.kind === 'group') {
    return {
      kind: 'group',
      profile: buildGroupProfileFromConversation(input.conversation, input.anchor),
    };
  }

  const agentProfile = resolveAgentProfileByName({
    agentName: input.conversation.title,
    agents: input.agents,
    t: input.t,
  });
  if (agentProfile) {
    return {
      kind: 'agent',
      profile: attachAgentProfileAnchor(agentProfile, input.anchor),
    };
  }

  return {
    kind: 'human',
    profile: resolveHumanProfileByName({
      name: input.conversation.title,
      conversations: input.conversations,
      t: input.t,
      anchor: input.anchor,
    }),
  };
}

/** Find a conversation matching a profile id/name. */
export function findConversationForProfile(
  conversations: WorkbenchConversation[],
  profile: { id: string; name: string },
): WorkbenchConversation | undefined {
  return conversations.find((item) => matchesProfileIdentity(item, profile));
}

/**
 * Pure DM open plan for agent/human profile chrome.
 * Returns null when no active profile is present.
 */
export function planDirectMessageOpen(input: {
  profile: { id: string; name: string } | null;
  conversations: WorkbenchConversation[];
  hasNavigateHandler: boolean;
}): DirectMessageOpenPlan | null {
  if (!input.profile) return null;

  const conversation = findConversationForProfile(input.conversations, input.profile);
  if (conversation) {
    return { kind: 'select', conversationId: conversation.id };
  }
  if (input.hasNavigateHandler) {
    return {
      kind: 'navigate',
      target: {
        name: input.profile.name,
        id: input.profile.id,
        kind: 'dm',
      },
    };
  }
  return { kind: 'toast', name: input.profile.name };
}

/** Deep-link style contact URI copied from human profile chrome. */
export function buildHumanProfileLink(profileId: string): string {
  return `agenthub://user/${profileId}`;
}
