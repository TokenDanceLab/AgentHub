import {
  useCallback,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { WorkbenchAgent, WorkbenchConversation } from '../platform';
import type { GlobalRailPage } from './GlobalRail';
import { WORKBENCH_MOCK_AGENT_CONFIGS, WORKBENCH_MOCK_CONTACT_MEMBERS } from './mockData';

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

export interface UseWorkbenchProfileChromeOptions {
  agents?: WorkbenchAgent[] | undefined;
  conversations: WorkbenchConversation[];
  t: (key: string, options?: Record<string, unknown>) => string;
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
    agent: {
      id: string;
      name: string;
      role: string;
      engine: string;
      model: string;
      state: string;
      skills: string[];
    },
    anchor: HTMLElement,
  ) => void;
  openConversationAvatar: (conversation: WorkbenchConversation, anchor: HTMLElement) => void;
  openAgentDirectMessage: () => void;
  openHumanDirectMessage: () => void;
  openAgentConfig: () => void;
  openGroupConversation: () => void;
  copyHumanProfileLink: () => void;
}

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

export function useWorkbenchProfileChrome({
  agents,
  conversations,
  t,
  selectConversation,
  setActivePage,
  showWorkbenchToast,
  copyText,
  composerInputRef,
  onNavigateToConversation,
}: UseWorkbenchProfileChromeOptions): WorkbenchProfileChrome {
  const [activeAgentProfile, setActiveAgentProfile] = useState<AgentProfileState | null>(null);
  const [activeHumanProfile, setActiveHumanProfile] = useState<HumanProfileState | null>(null);
  const [activeGroupProfile, setActiveGroupProfile] = useState<GroupProfileState | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | undefined>(undefined);

  const agentProfileByName = useCallback((agentName: string): Omit<AgentProfileState, 'anchor'> | null => {
    const normalized = agentName.toLowerCase();
    const runtimeAgent = (agents ?? []).find((agent) => agent.name.toLowerCase() === normalized);
    const configured = configuredAgentProfiles().find((agent) => (
      agent.name.toLowerCase() === normalized || agent.id.toLowerCase() === normalized
    ));

    if (configured) return configured;
    if (!runtimeAgent) return null;

    return {
      id: runtimeAgent.id,
      name: runtimeAgent.name,
      role: runtimeAgent.description ?? t('label.agent'),
      engine: t('label.agentHub'),
      model: runtimeAgent.model ?? t('status.unconfigured'),
      state: runtimeAgent.status ?? 'available',
      skills: [],
    };
  }, [agents, t]);

  const humanProfileByName = useCallback((name: string, anchor: HTMLElement): HumanProfileState => {
    const normalized = name.toLowerCase();
    const contact = WORKBENCH_MOCK_CONTACT_MEMBERS.find((item) => (
      item.name.toLowerCase() === normalized || item.id.toLowerCase() === normalized
    ));
    const conversation = conversations.find((item) => (
      item.title.toLowerCase() === normalized || item.id.toLowerCase() === normalized
    ));
    const resolvedName = contact?.name ?? conversation?.title ?? name;

    return {
      id: contact?.id ?? conversation?.id ?? resolvedName.toLowerCase(),
      name: resolvedName,
      initials: contact?.initials ?? conversation?.avatarLabel ?? resolvedName.slice(0, 1).toUpperCase(),
      org: contact?.org ?? t('label.contact'),
      status: contact?.status ?? conversation?.updatedLabel ?? t('status.online'),
      tag: contact?.tag ?? (conversation?.kind === 'group' ? t('chat.kind.group') : t('chat.kind.friend')),
      subtitle: conversation?.subtitle ?? contact?.org ?? t('chat.kind.friend'),
      avatarColor: conversation?.avatarColor,
      anchor,
    };
  }, [conversations, t]);

  const openAgentProfile = useCallback((agentName: string, anchor: HTMLElement): void => {
    const profile = agentProfileByName(agentName);
    if (!profile) {
      setActiveAgentProfile(null);
      setActiveGroupProfile(null);
      setActiveHumanProfile(humanProfileByName(agentName, anchor));
      return;
    }
    setActiveHumanProfile(null);
    setActiveGroupProfile(null);
    setActiveAgentProfile({ ...profile, anchor });
  }, [agentProfileByName, humanProfileByName]);

  const openAgentProfileFromConfig = useCallback((
    agent: {
      id: string;
      name: string;
      role: string;
      engine: string;
      model: string;
      state: string;
      skills: string[];
    },
    anchor: HTMLElement,
  ): void => {
    setActiveHumanProfile(null);
    setActiveGroupProfile(null);
    setActiveAgentProfile({ ...agent, anchor });
  }, []);

  const openConversationAvatar = useCallback((conversation: WorkbenchConversation, anchor: HTMLElement): void => {
    setActiveAgentProfile(null);
    setActiveHumanProfile(null);
    setActiveGroupProfile(null);

    if (conversation.kind === 'group') {
      setActiveGroupProfile({
        id: conversation.id,
        name: conversation.title,
        memberNames: conversation.members ?? [],
        anchor,
      });
      return;
    }

    const profile = agentProfileByName(conversation.title);
    if (profile) {
      setActiveAgentProfile({ ...profile, anchor });
    } else {
      setActiveHumanProfile(humanProfileByName(conversation.title, anchor));
    }
  }, [agentProfileByName, humanProfileByName]);

  const openAgentDirectMessage = useCallback((): void => {
    if (!activeAgentProfile) return;
    const conversation = conversations.find((item) => (
      item.title.toLowerCase() === activeAgentProfile.name.toLowerCase()
      || item.id.toLowerCase() === activeAgentProfile.id.toLowerCase()
    ));
    if (conversation) {
      selectConversation(conversation.id);
    } else if (onNavigateToConversation) {
      onNavigateToConversation({ name: activeAgentProfile.name, id: activeAgentProfile.id, kind: 'dm' });
    } else {
      showWorkbenchToast(t('toast.noDmSession', { name: activeAgentProfile.name }));
      return;
    }
    setActivePage('chat');
    setActiveAgentProfile(null);
    setActiveHumanProfile(null);
    setActiveGroupProfile(null);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }, [
    activeAgentProfile,
    composerInputRef,
    conversations,
    onNavigateToConversation,
    selectConversation,
    setActivePage,
    showWorkbenchToast,
    t,
  ]);

  const openHumanDirectMessage = useCallback((): void => {
    if (!activeHumanProfile) return;
    const conversation = conversations.find((item) => (
      item.title.toLowerCase() === activeHumanProfile.name.toLowerCase()
      || item.id.toLowerCase() === activeHumanProfile.id.toLowerCase()
    ));
    if (conversation) {
      selectConversation(conversation.id);
    } else if (onNavigateToConversation) {
      onNavigateToConversation({ name: activeHumanProfile.name, id: activeHumanProfile.id, kind: 'dm' });
    } else {
      showWorkbenchToast(t('toast.noDmSession', { name: activeHumanProfile.name }));
      return;
    }
    setActivePage('chat');
    setActiveHumanProfile(null);
    setActiveAgentProfile(null);
    setActiveGroupProfile(null);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }, [
    activeHumanProfile,
    composerInputRef,
    conversations,
    onNavigateToConversation,
    selectConversation,
    setActivePage,
    showWorkbenchToast,
    t,
  ]);

  const openAgentConfig = useCallback((): void => {
    if (!activeAgentProfile) return;
    setFocusedAgentId(activeAgentProfile.id);
    setActivePage('agents');
    setActiveAgentProfile(null);
    showWorkbenchToast(t('toast.agentConfigOpened', { name: activeAgentProfile.name }));
  }, [activeAgentProfile, setActivePage, showWorkbenchToast, t]);

  const openGroupConversation = useCallback((): void => {
    if (!activeGroupProfile) return;
    selectConversation(activeGroupProfile.id);
    setActiveGroupProfile(null);
  }, [activeGroupProfile, selectConversation]);

  const copyHumanProfileLink = useCallback((): void => {
    if (!activeHumanProfile) return;
    copyText(`agenthub://user/${activeHumanProfile.id}`);
    showWorkbenchToast(t('toast.contactLinkCopied'));
  }, [activeHumanProfile, copyText, showWorkbenchToast, t]);

  return {
    activeAgentProfile,
    activeHumanProfile,
    activeGroupProfile,
    focusedAgentId,
    setActiveAgentProfile,
    setActiveHumanProfile,
    setActiveGroupProfile,
    openAgentProfile,
    openAgentProfileFromConfig,
    openConversationAvatar,
    openAgentDirectMessage,
    openHumanDirectMessage,
    openAgentConfig,
    openGroupConversation,
    copyHumanProfileLink,
  };
}
