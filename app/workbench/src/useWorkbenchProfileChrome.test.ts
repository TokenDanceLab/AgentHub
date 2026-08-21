// real_tested=true
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import { useWorkbenchProfileChrome } from './useWorkbenchProfileChrome';
import type { UseWorkbenchProfileChromeOptions } from './workbenchProfileChromeHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   useWorkbenchProfileChrome — hook-level wiring over the #709 helpers.

   Covers default state, agent/human/group profile opening (configured,
   runtime, and fallback branches), conversation-avatar plans, the three
   direct-message branches (select/navigate/toast), agent config focus,
   group conversation opening, and human profile-link copying.
   ═══════════════════════════════════════════════════════════════════════ */

/** Key-echo translator matching the helper test convention. */
function t(key: string, options?: Record<string, unknown>): string {
  if (options && 'name' in options) return `${key}:${String(options.name)}`;
  return key;
}

function conversation(
  partial: Partial<WorkbenchConversation> & Pick<WorkbenchConversation, 'id' | 'title'>,
): WorkbenchConversation {
  return { kind: 'direct', ...partial };
}

function createAnchor(): HTMLElement {
  return document.createElement('div');
}

/** Fixture human profile matching the mock contact member "Johnny". */
function johnnyProfile(anchor: HTMLElement = createAnchor()) {
  return {
    id: 'johnny',
    name: 'Johnny',
    initials: 'J',
    org: 'AgentHub Desktop',
    status: '刚刚活跃',
    tag: '维护者',
    subtitle: 'AgentHub Desktop',
    anchor,
  };
}

function renderProfileChrome(overrides: Partial<UseWorkbenchProfileChromeOptions> = {}) {
  const selectConversation = vi.fn();
  const setActivePage = vi.fn();
  const showWorkbenchToast = vi.fn();
  const copyText = vi.fn();
  const composerInputRef: { current: HTMLTextAreaElement | null } = { current: null };

  const rendered = renderHook(() => useWorkbenchProfileChrome({
    conversations: [],
    t,
    selectConversation,
    setActivePage,
    showWorkbenchToast,
    copyText,
    composerInputRef,
    ...overrides,
  }));

  return {
    ...rendered,
    selectConversation,
    setActivePage,
    showWorkbenchToast,
    copyText,
    composerInputRef,
  };
}

describe('useWorkbenchProfileChrome', () => {
  it('exposes default empty profile state and every handler', () => {
    const { result } = renderProfileChrome();

    expect(result.current.activeAgentProfile).toBeNull();
    expect(result.current.activeHumanProfile).toBeNull();
    expect(result.current.activeGroupProfile).toBeNull();
    expect(result.current.focusedAgentId).toBeUndefined();
    expect(typeof result.current.setActiveAgentProfile).toBe('function');
    expect(typeof result.current.setActiveHumanProfile).toBe('function');
    expect(typeof result.current.setActiveGroupProfile).toBe('function');
    expect(typeof result.current.openAgentProfile).toBe('function');
    expect(typeof result.current.openAgentProfileFromConfig).toBe('function');
    expect(typeof result.current.openConversationAvatar).toBe('function');
    expect(typeof result.current.openAgentDirectMessage).toBe('function');
    expect(typeof result.current.openHumanDirectMessage).toBe('function');
    expect(typeof result.current.openAgentConfig).toBe('function');
    expect(typeof result.current.openGroupConversation).toBe('function');
    expect(typeof result.current.copyHumanProfileLink).toBe('function');
  });

  it('opens a configured agent profile by name and attaches the anchor', () => {
    const anchor = createAnchor();
    const { result } = renderProfileChrome();

    act(() => {
      result.current.openAgentProfile('Builder', anchor);
    });

    expect(result.current.activeHumanProfile).toBeNull();
    expect(result.current.activeGroupProfile).toBeNull();
    expect(result.current.activeAgentProfile).toMatchObject({
      id: 'builder-agent',
      name: 'Builder',
      role: '代码实现',
      anchor,
    });
    expect(result.current.activeAgentProfile?.engine).toEqual(expect.any(String));
    expect(result.current.activeAgentProfile?.model).toEqual(expect.any(String));
    expect(result.current.activeAgentProfile?.state).toEqual(expect.any(String));
    expect(result.current.activeAgentProfile?.skills).toEqual(expect.any(Array));
  });

  it('resolves runtime agent fields when the opened name is not configured', () => {
    const runtimeAgent: WorkbenchAgent = {
      id: 'rt-1',
      name: 'Runtime Only',
      description: 'does runtime things',
      model: 'gpt-test',
      status: 'available',
    };
    const { result } = renderProfileChrome({ agents: [runtimeAgent] });

    // Case-insensitive name lookup.
    act(() => {
      result.current.openAgentProfile('runtime only', createAnchor());
    });

    expect(result.current.activeAgentProfile).toMatchObject({
      id: 'rt-1',
      name: 'Runtime Only',
      role: 'does runtime things',
      engine: 'label.agentHub',
      model: 'gpt-test',
      state: 'available',
      skills: [],
    });
  });

  it('falls back to a human profile when the name matches no agent', () => {
    const anchor = createAnchor();
    const { result } = renderProfileChrome();

    act(() => {
      result.current.openAgentProfile('Johnny', anchor);
    });

    expect(result.current.activeAgentProfile).toBeNull();
    expect(result.current.activeGroupProfile).toBeNull();
    expect(result.current.activeHumanProfile).toMatchObject({
      id: 'johnny',
      name: 'Johnny',
      initials: 'J',
      org: 'AgentHub Desktop',
      status: '刚刚活跃',
      tag: '维护者',
      subtitle: 'AgentHub Desktop',
      anchor,
    });
  });

  it('builds an agent profile directly from a config object', () => {
    const anchor = createAnchor();
    const { result } = renderProfileChrome();

    act(() => {
      result.current.openAgentProfileFromConfig({
        id: 'cfg-1',
        name: 'Custom Agent',
        role: 'R',
        engine: 'E',
        model: 'M',
        state: 'ready',
        skills: ['s1'],
      }, anchor);
    });

    expect(result.current.activeHumanProfile).toBeNull();
    expect(result.current.activeGroupProfile).toBeNull();
    expect(result.current.activeAgentProfile).toEqual({
      id: 'cfg-1',
      name: 'Custom Agent',
      role: 'R',
      engine: 'E',
      model: 'M',
      state: 'ready',
      skills: ['s1'],
      anchor,
    });
  });

  it('opens a group profile from a group conversation avatar, replacing any open profile', () => {
    const anchor = createAnchor();
    const { result } = renderProfileChrome();

    act(() => {
      result.current.openAgentProfile('Builder', createAnchor());
    });
    act(() => {
      result.current.openConversationAvatar(
        conversation({ id: 'g1', title: 'AI 游戏项目', kind: 'group', members: ['demo-user', 'Johnny'] }),
        anchor,
      );
    });

    expect(result.current.activeAgentProfile).toBeNull();
    expect(result.current.activeHumanProfile).toBeNull();
    expect(result.current.activeGroupProfile).toEqual({
      id: 'g1',
      name: 'AI 游戏项目',
      memberNames: ['demo-user', 'Johnny'],
      anchor,
    });
  });

  it('opens an agent profile from a direct conversation avatar', () => {
    const { result } = renderProfileChrome();

    act(() => {
      result.current.openConversationAvatar(
        conversation({ id: 'c1', title: 'Builder' }),
        createAnchor(),
      );
    });

    expect(result.current.activeAgentProfile?.name).toBe('Builder');
    expect(result.current.activeHumanProfile).toBeNull();
    expect(result.current.activeGroupProfile).toBeNull();
  });

  it('opens a human profile from a conversation avatar for an unknown name', () => {
    const anchor = createAnchor();
    const listedConversation = conversation({
      id: 'c-new',
      title: 'Someone New',
      subtitle: 'sub text',
      avatarColor: '#abc',
    });
    const { result } = renderProfileChrome({ conversations: [listedConversation] });

    act(() => {
      result.current.openConversationAvatar(listedConversation, anchor);
    });

    // A conversation present in the list enriches the profile with metadata.
    expect(result.current.activeAgentProfile).toBeNull();
    expect(result.current.activeHumanProfile).toMatchObject({
      id: 'c-new',
      name: 'Someone New',
      initials: 'S',
      org: 'label.contact',
      status: 'status.online',
      tag: 'chat.kind.friend',
      subtitle: 'sub text',
      avatarColor: '#abc',
      anchor,
    });

    // A conversation missing from the list falls back to name-derived fields.
    act(() => {
      result.current.openConversationAvatar(
        conversation({ id: 'c-other', title: 'Zeta Q', subtitle: 'unlisted sub', avatarColor: '#def' }),
        createAnchor(),
      );
    });
    expect(result.current.activeHumanProfile).toMatchObject({
      id: 'zeta q',
      name: 'Zeta Q',
      initials: 'Z',
      org: 'label.contact',
      status: 'status.online',
      tag: 'chat.kind.friend',
      subtitle: 'chat.kind.friend',
    });
  });

  it('selects an existing conversation for an agent direct message and focuses the composer', async () => {
    const textarea = document.createElement('textarea');
    const focusSpy = vi.spyOn(textarea, 'focus');
    const { result, selectConversation, setActivePage, composerInputRef } = renderProfileChrome({
      conversations: [conversation({ id: 'c-builder', title: 'Builder' })],
    });
    composerInputRef.current = textarea;

    act(() => {
      result.current.openAgentProfile('Builder', createAnchor());
    });
    act(() => {
      result.current.openAgentDirectMessage();
    });

    expect(selectConversation).toHaveBeenCalledWith('c-builder');
    expect(setActivePage).toHaveBeenCalledWith('chat');
    expect(result.current.activeAgentProfile).toBeNull();
    expect(result.current.activeHumanProfile).toBeNull();
    expect(result.current.activeGroupProfile).toBeNull();
    expect(focusSpy).not.toHaveBeenCalled();

    // The composer focus is deferred one macrotask after navigation.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('navigates via the handler when no conversation matches the agent profile', () => {
    const onNavigateToConversation = vi.fn();
    const { result, selectConversation, setActivePage } = renderProfileChrome({
      conversations: [],
      onNavigateToConversation,
    });

    act(() => {
      result.current.openAgentProfile('Builder', createAnchor());
    });
    act(() => {
      result.current.openAgentDirectMessage();
    });

    expect(onNavigateToConversation).toHaveBeenCalledWith({
      name: 'Builder',
      id: 'builder-agent',
      kind: 'dm',
    });
    expect(selectConversation).not.toHaveBeenCalled();
    expect(setActivePage).toHaveBeenCalledWith('chat');
    expect(result.current.activeAgentProfile).toBeNull();
  });

  it('shows a toast without navigating when no conversation and no handler exist', () => {
    const { result, selectConversation, setActivePage, showWorkbenchToast } = renderProfileChrome();

    act(() => {
      result.current.openAgentProfile('Builder', createAnchor());
    });
    act(() => {
      result.current.openAgentDirectMessage();
    });

    expect(showWorkbenchToast).toHaveBeenCalledWith('toast.noDmSession:Builder');
    expect(selectConversation).not.toHaveBeenCalled();
    expect(setActivePage).not.toHaveBeenCalled();
    // The toast branch keeps the profile open.
    expect(result.current.activeAgentProfile).not.toBeNull();
  });

  it('selects an existing conversation for a human direct message', () => {
    const { result, selectConversation, setActivePage } = renderProfileChrome({
      conversations: [conversation({ id: 'c-j', title: 'Johnny' })],
    });

    act(() => {
      result.current.setActiveHumanProfile(johnnyProfile());
    });
    act(() => {
      result.current.openHumanDirectMessage();
    });

    expect(selectConversation).toHaveBeenCalledWith('c-j');
    expect(setActivePage).toHaveBeenCalledWith('chat');
    expect(result.current.activeHumanProfile).toBeNull();
  });

  it('navigates via the handler when no conversation matches the human profile', () => {
    const onNavigateToConversation = vi.fn();
    const { result, selectConversation, setActivePage } = renderProfileChrome({
      conversations: [],
      onNavigateToConversation,
    });

    act(() => {
      result.current.setActiveHumanProfile(johnnyProfile());
    });
    act(() => {
      result.current.openHumanDirectMessage();
    });

    expect(onNavigateToConversation).toHaveBeenCalledWith({
      name: 'Johnny',
      id: 'johnny',
      kind: 'dm',
    });
    expect(selectConversation).not.toHaveBeenCalled();
    expect(setActivePage).toHaveBeenCalledWith('chat');
    expect(result.current.activeHumanProfile).toBeNull();
  });

  it('shows a toast for a human direct message without conversation or handler', () => {
    const { result, selectConversation, setActivePage, showWorkbenchToast } = renderProfileChrome();

    act(() => {
      result.current.setActiveHumanProfile(johnnyProfile());
    });
    act(() => {
      result.current.openHumanDirectMessage();
    });

    expect(showWorkbenchToast).toHaveBeenCalledWith('toast.noDmSession:Johnny');
    expect(selectConversation).not.toHaveBeenCalled();
    expect(setActivePage).not.toHaveBeenCalled();
    expect(result.current.activeHumanProfile).not.toBeNull();
  });

  it('stays inert when opening a direct message without an active profile', () => {
    const { result, selectConversation, setActivePage, showWorkbenchToast } = renderProfileChrome();

    act(() => {
      result.current.openAgentDirectMessage();
    });
    act(() => {
      result.current.openHumanDirectMessage();
    });

    expect(selectConversation).not.toHaveBeenCalled();
    expect(setActivePage).not.toHaveBeenCalled();
    expect(showWorkbenchToast).not.toHaveBeenCalled();
  });

  it('opens agent config from an active agent profile and remembers the focused id', () => {
    const { result, setActivePage, showWorkbenchToast } = renderProfileChrome();

    // No active profile → inert.
    act(() => {
      result.current.openAgentConfig();
    });
    expect(result.current.focusedAgentId).toBeUndefined();
    expect(setActivePage).not.toHaveBeenCalled();

    act(() => {
      result.current.openAgentProfile('Builder', createAnchor());
    });
    act(() => {
      result.current.openAgentConfig();
    });

    expect(result.current.focusedAgentId).toBe('builder-agent');
    expect(setActivePage).toHaveBeenCalledWith('agents');
    expect(showWorkbenchToast).toHaveBeenCalledWith('toast.agentConfigOpened:Builder');
    expect(result.current.activeAgentProfile).toBeNull();
  });

  it('opens a group conversation and clears the group profile', () => {
    const { result, selectConversation } = renderProfileChrome();

    // No active group profile → inert.
    act(() => {
      result.current.openGroupConversation();
    });
    expect(selectConversation).not.toHaveBeenCalled();

    act(() => {
      result.current.setActiveGroupProfile({
        id: 'g1',
        name: 'AI 游戏项目',
        memberNames: ['demo-user'],
        anchor: createAnchor(),
      });
    });
    act(() => {
      result.current.openGroupConversation();
    });

    expect(selectConversation).toHaveBeenCalledWith('g1');
    expect(result.current.activeGroupProfile).toBeNull();
  });

  it('copies a deep link for an active human profile', () => {
    const { result, copyText, showWorkbenchToast } = renderProfileChrome();

    // No active human profile → inert.
    act(() => {
      result.current.copyHumanProfileLink();
    });
    expect(copyText).not.toHaveBeenCalled();

    act(() => {
      result.current.setActiveHumanProfile(johnnyProfile());
    });
    act(() => {
      result.current.copyHumanProfileLink();
    });

    expect(copyText).toHaveBeenCalledWith('agenthub://user/johnny');
    expect(showWorkbenchToast).toHaveBeenCalledWith('toast.contactLinkCopied');
  });
});
