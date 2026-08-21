import {
  useCallback,
  useState,
} from 'react';
import {
  attachAgentProfileAnchor,
  buildAgentProfileFromConfig,
  buildHumanProfileLink,
  planConversationAvatarOpen,
  planDirectMessageOpen,
  resolveAgentProfileByName,
  resolveHumanProfileByName,
  type AgentProfileState,
  type GroupProfileState,
  type HumanProfileState,
  type UseWorkbenchProfileChromeOptions,
  type WorkbenchProfileChrome,
} from './workbenchProfileChromeHelpers';

export {
  agentStateLabel,
  attachAgentProfileAnchor,
  buildAgentProfileFromConfig,
  buildGroupProfileFromConversation,
  buildHumanProfileLink,
  configuredAgentProfiles,
  findConversationForProfile,
  matchesProfileIdentity,
  planConversationAvatarOpen,
  planDirectMessageOpen,
  resolveAgentProfileByName,
  resolveHumanProfileByName,
  type AgentProfileState,
  type ConfiguredAgentProfileInput,
  type ConversationAvatarOpenPlan,
  type DirectMessageOpenPlan,
  type GroupProfileState,
  type HumanProfileState,
  type ProfileChromeTranslate,
  type UseWorkbenchProfileChromeOptions,
  type WorkbenchProfileChrome,
} from './workbenchProfileChromeHelpers';

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

  const openAgentProfile = useCallback((agentName: string, anchor: HTMLElement): void => {
    const profile = resolveAgentProfileByName({ agentName, agents, t });
    if (!profile) {
      setActiveAgentProfile(null);
      setActiveGroupProfile(null);
      setActiveHumanProfile(resolveHumanProfileByName({
        name: agentName,
        conversations,
        t,
        anchor,
      }));
      return;
    }
    setActiveHumanProfile(null);
    setActiveGroupProfile(null);
    setActiveAgentProfile(attachAgentProfileAnchor(profile, anchor));
  }, [agents, conversations, t]);

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
    setActiveAgentProfile(buildAgentProfileFromConfig(agent, anchor));
  }, []);

  const openConversationAvatar = useCallback((conversation: typeof conversations[number], anchor: HTMLElement): void => {
    setActiveAgentProfile(null);
    setActiveHumanProfile(null);
    setActiveGroupProfile(null);

    const plan = planConversationAvatarOpen({
      conversation,
      conversations,
      anchor,
      agents,
      t,
    });
    if (plan.kind === 'group') {
      setActiveGroupProfile(plan.profile);
      return;
    }
    if (plan.kind === 'agent') {
      setActiveAgentProfile(plan.profile);
      return;
    }
    setActiveHumanProfile(plan.profile);
  }, [agents, conversations, t]);

  const openAgentDirectMessage = useCallback((): void => {
    const plan = planDirectMessageOpen({
      profile: activeAgentProfile,
      conversations,
      hasNavigateHandler: Boolean(onNavigateToConversation),
    });
    if (!plan) return;

    if (plan.kind === 'select') {
      selectConversation(plan.conversationId);
    } else if (plan.kind === 'navigate') {
      onNavigateToConversation?.(plan.target);
    } else {
      showWorkbenchToast(t('toast.noDmSession', { name: plan.name }));
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
    const plan = planDirectMessageOpen({
      profile: activeHumanProfile,
      conversations,
      hasNavigateHandler: Boolean(onNavigateToConversation),
    });
    if (!plan) return;

    if (plan.kind === 'select') {
      selectConversation(plan.conversationId);
    } else if (plan.kind === 'navigate') {
      onNavigateToConversation?.(plan.target);
    } else {
      showWorkbenchToast(t('toast.noDmSession', { name: plan.name }));
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
    copyText(buildHumanProfileLink(activeHumanProfile.id));
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
