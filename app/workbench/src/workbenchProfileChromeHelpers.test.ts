import { describe, expect, it } from 'vitest';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import {
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
} from './workbenchProfileChromeHelpers';

function t(key: string, options?: Record<string, unknown>): string {
  if (options && 'name' in options) return `${key}:${String(options.name)}`;
  return key;
}

function conversation(partial: Partial<WorkbenchConversation> & Pick<WorkbenchConversation, 'id' | 'title'>): WorkbenchConversation {
  return {
    kind: 'direct',
    ...partial,
  };
}

describe('workbenchProfileChromeHelpers', () => {
  it('projects configured agent profiles without anchors', () => {
    const profiles = configuredAgentProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      role: expect.any(String),
      engine: expect.any(String),
      model: expect.any(String),
      state: expect.any(String),
      skills: expect.any(Array),
    });
    expect(profiles[0]).not.toHaveProperty('anchor');
  });

  it('maps agent runtime states to i18n keys with fallbacks', () => {
    expect(agentStateLabel(t, 'running')).toBe('agent.state.running');
    expect(agentStateLabel(t, 'ready')).toBe('agent.state.ready');
    expect(agentStateLabel(t, 'available')).toBe('agent.state.ready');
    expect(agentStateLabel(t, 'waiting')).toBe('agent.state.waiting');
    expect(agentStateLabel(t, 'configuring')).toBe('agent.state.configuring');
    expect(agentStateLabel(t, 'unavailable')).toBe('agent.state.unavailable');
    expect(agentStateLabel(t, 'custom')).toBe('custom');
    expect(agentStateLabel(t, '')).toBe('label.agent');
  });

  it('matches profile identity on name/title/id case-insensitively', () => {
    expect(matchesProfileIdentity({ id: 'a1', title: 'Builder' }, { id: 'x', name: 'builder' })).toBe(true);
    expect(matchesProfileIdentity({ id: 'A1', name: 'Other' }, { id: 'a1', name: 'builder' })).toBe(true);
    expect(matchesProfileIdentity({ id: 'z', title: 'Other' }, { id: 'a1', name: 'builder' })).toBe(false);
  });

  it('prefers configured agent profiles over runtime agents', () => {
    const profiles = configuredAgentProfiles();
    const first = profiles[0]!;
    const runtimeAgents: WorkbenchAgent[] = [
      {
        id: 'runtime-1',
        name: first.name,
        description: 'runtime role',
        model: 'runtime-model',
        status: 'configuring',
      },
    ];

    const resolved = resolveAgentProfileByName({
      agentName: first.name.toUpperCase(),
      agents: runtimeAgents,
      t,
    });
    expect(resolved).toEqual(first);
  });

  it('falls back to runtime agent profile when not configured', () => {
    const resolved = resolveAgentProfileByName({
      agentName: 'Runtime Only',
      agents: [
        {
          id: 'rt-1',
          name: 'Runtime Only',
          description: 'does runtime things',
          model: 'gpt-test',
          status: 'available',
        },
      ],
      t,
    });
    expect(resolved).toEqual({
      id: 'rt-1',
      name: 'Runtime Only',
      role: 'does runtime things',
      engine: 'label.agentHub',
      model: 'gpt-test',
      state: 'available',
      skills: [],
    });
  });

  it('returns null when no configured or runtime agent matches', () => {
    expect(resolveAgentProfileByName({
      agentName: 'missing-agent',
      agents: [],
      t,
    })).toBeNull();
  });

  it('resolves human profiles from mock contacts and conversation metadata', () => {
    const anchor = {} as HTMLElement;
    const fromContact = resolveHumanProfileByName({
      name: 'Johnny',
      conversations: [],
      t,
      anchor,
    });
    expect(fromContact).toMatchObject({
      id: 'johnny',
      name: 'Johnny',
      initials: 'J',
      org: 'AgentHub Desktop',
      status: '刚刚活跃',
      tag: '维护者',
      anchor,
    });

    const fromConversation = resolveHumanProfileByName({
      name: 'Nora',
      conversations: [
        conversation({
          id: 'nora-dm',
          title: 'Nora',
          subtitle: 'friend chat',
          updatedLabel: 'just now',
          avatarLabel: 'N',
          avatarColor: '#abc',
        }),
      ],
      t,
      anchor,
    });
    expect(fromConversation).toEqual({
      id: 'nora-dm',
      name: 'Nora',
      initials: 'N',
      org: 'label.contact',
      status: 'just now',
      tag: 'chat.kind.friend',
      subtitle: 'friend chat',
      avatarColor: '#abc',
      anchor,
    });
  });

  it('builds agent/group profiles and attaches anchors', () => {
    const anchor = {} as HTMLElement;
    const agent = attachAgentProfileAnchor({
      id: 'a1',
      name: 'Builder',
      role: 'build',
      engine: 'hub',
      model: 'm',
      state: 'ready',
      skills: ['s1'],
    }, anchor);
    expect(agent.anchor).toBe(anchor);
    expect(agent.name).toBe('Builder');

    const fromConfig = buildAgentProfileFromConfig({
      id: 'a2',
      name: 'Reviewer',
      role: 'review',
      engine: 'hub',
      model: 'm2',
      state: 'running',
      skills: [],
    }, anchor);
    expect(fromConfig).toEqual({
      id: 'a2',
      name: 'Reviewer',
      role: 'review',
      engine: 'hub',
      model: 'm2',
      state: 'running',
      skills: [],
      anchor,
    });

    const group = buildGroupProfileFromConversation(
      conversation({
        id: 'g1',
        title: 'Design',
        kind: 'group',
        members: ['A', 'B'],
      }),
      anchor,
    );
    expect(group).toEqual({
      id: 'g1',
      name: 'Design',
      memberNames: ['A', 'B'],
      anchor,
    });
  });

  it('plans conversation avatar opens for group/agent/human', () => {
    const anchor = {} as HTMLElement;
    const configured = configuredAgentProfiles()[0]!;

    const groupConversation = conversation({
      id: 'g1',
      title: 'Design',
      kind: 'group',
      members: ['A'],
    });
    const groupPlan = planConversationAvatarOpen({
      conversation: groupConversation,
      conversations: [groupConversation],
      anchor,
      agents: [],
      t,
    });
    expect(groupPlan).toEqual({
      kind: 'group',
      profile: {
        id: 'g1',
        name: 'Design',
        memberNames: ['A'],
        anchor,
      },
    });

    const agentConversation = conversation({
      id: 'dm-agent',
      title: configured.name,
    });
    const agentPlan = planConversationAvatarOpen({
      conversation: agentConversation,
      conversations: [agentConversation],
      anchor,
      agents: [],
      t,
    });
    expect(agentPlan.kind).toBe('agent');
    if (agentPlan.kind === 'agent') {
      expect(agentPlan.profile).toEqual({ ...configured, anchor });
    }

    const humanConversation = conversation({
      id: 'dm-human',
      title: 'Unknown Person',
      avatarLabel: 'U',
    });
    const humanPlan = planConversationAvatarOpen({
      conversation: humanConversation,
      conversations: [humanConversation],
      anchor,
      agents: [],
      t,
    });
    expect(humanPlan.kind).toBe('human');
    if (humanPlan.kind === 'human') {
      expect(humanPlan.profile.id).toBe('dm-human');
      expect(humanPlan.profile.name).toBe('Unknown Person');
      expect(humanPlan.profile.anchor).toBe(anchor);
    }
  });

  it('finds conversations and plans direct-message opens', () => {
    const conversations = [
      conversation({ id: 'c1', title: 'Builder' }),
      conversation({ id: 'c2', title: 'Johnny' }),
    ];

    expect(findConversationForProfile(conversations, { id: 'x', name: 'Johnny' })?.id).toBe('c2');
    expect(findConversationForProfile(conversations, { id: 'missing', name: 'Nope' })).toBeUndefined();

    expect(planDirectMessageOpen({
      profile: null,
      conversations,
      hasNavigateHandler: true,
    })).toBeNull();

    expect(planDirectMessageOpen({
      profile: { id: 'x', name: 'Builder' },
      conversations,
      hasNavigateHandler: false,
    })).toEqual({ kind: 'select', conversationId: 'c1' });

    expect(planDirectMessageOpen({
      profile: { id: 'new-id', name: 'New Person' },
      conversations,
      hasNavigateHandler: true,
    })).toEqual({
      kind: 'navigate',
      target: { name: 'New Person', id: 'new-id', kind: 'dm' },
    });

    expect(planDirectMessageOpen({
      profile: { id: 'new-id', name: 'New Person' },
      conversations,
      hasNavigateHandler: false,
    })).toEqual({ kind: 'toast', name: 'New Person' });
  });

  it('builds human profile deep links', () => {
    expect(buildHumanProfileLink('johnny')).toBe('agenthub://user/johnny');
  });
});
