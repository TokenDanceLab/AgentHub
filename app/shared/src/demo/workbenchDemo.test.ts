import { describe, expect, it } from 'vitest';
import {
  createWorkbenchDemoRuntimeStore,
  createWorkbenchDemoStore,
  projectGroupMessageLoopHubMessages,
  projectGroupMessageLoopTranscript,
  resolveDemoWorkbenchTranscript,
  whenChatviewTranscriptsReady,
} from './workbenchDemo';
import { TEAMRUN_DEMO_CONVERSATION_ID, teamRunDemoScenario } from './teamrunDemo';

describe('workbench v4 demo data source', () => {
  it('derives the Builder pinned announcement from the design demo summary', () => {
    const store = createWorkbenchDemoStore();
    const builder = store.conversations.find((conversation) => conversation.id === 'builder');

    // Builder transcript uses chatviewFixtures IDs; demoWorkbenchPins[0].messageId
    // ('builder-msg-1') does not match any block in chatviewBuilderTranscript,
    // so pinnedAnnouncement is not set from the static store.
    expect(builder).toBeDefined();
    expect(builder?.pinnedAnnouncement).toBeUndefined();
  });

  it('keeps non-pinned demo conversations free of pinned state', () => {
    const store = createWorkbenchDemoStore();
    const reviewer = store.conversations.find((conversation) => conversation.id === 'reviewer');

    expect(reviewer).not.toHaveProperty('pinnedAnnouncement');
  });

  it('resolves per-conversation transcripts with a fallback preview transcript', async () => {
    // Chatview transcripts are lazy-loaded and may not be available synchronously
    // in test environments. Await the async load before asserting fixture data.
    await whenChatviewTranscriptsReady();
    const johnnyTranscript = resolveDemoWorkbenchTranscript('johnny');
    expect(johnnyTranscript[0]).toEqual(expect.objectContaining({
      id: 'johnny-user-1',
      kind: 'text',
    }));
    expect(johnnyTranscript).toHaveLength(3);

    // builder IS in the chatview fixtures, so it resolves to the full fixture transcript.
    const builderTranscript = resolveDemoWorkbenchTranscript('builder');
    expect(builderTranscript[0]).toEqual(expect.objectContaining({
      id: 'batt1',
      kind: 'attachment',
    }));
  });

  it('exposes the project group Agent-to-Agent message loop fixture', () => {
    const store = createWorkbenchDemoStore();
    const group = store.conversations.find((conversation) => conversation.id === 'agent-collab');

    expect(group).toEqual(expect.objectContaining({
      kind: 'group',
      title: 'Agent 协作群',
    }));
    // projectGroupMessageLoopHubMessages are the raw input; the normalized
    // transcript is projectGroupMessageLoopTranscript.
    expect(projectGroupMessageLoopHubMessages).toHaveLength(8);
    expect(projectGroupMessageLoopTranscript).toEqual([
      expect.objectContaining({
        id: 'hub-message-a2a-dm-builder',
        displayTitle: 'Agent DM',
        badgeLabel: '@Agent queued',
      }),
      expect.objectContaining({
        id: 'hub-message-a2a-agent-to-agent',
        displayTitle: 'Agent -> Agent',
        displayDetail: 'IM agent_dm · Builder -> Reviewer',
      }),
      expect.objectContaining({
        id: 'hub-message-project-group-mention-reviewer',
        displayTitle: 'Group @Agent',
        badgeLabel: '@Agent queued',
      }),
      expect.objectContaining({
        id: 'hub-message-project-group-queued-reviewer',
        displayTitle: 'Group @Agent',
        badgeLabel: '@Agent queued',
      }),
      expect.objectContaining({
        id: 'hub-message-project-group-route-decision',
        kind: 'route_decision',
        action: 'dispatch',
        targetAgent: 'Reviewer',
      }),
      expect.objectContaining({
        id: 'hub-message-project-group-assigned-reviewer',
        displayTitle: 'Group @Agent',
        badgeLabel: '@Agent assigned',
        badgeVariant: 'thinking',
      }),
      expect.objectContaining({
        id: 'hub-message-project-group-working-reviewer',
        displayTitle: 'Group @Agent',
        badgeLabel: '@Agent working',
        badgeVariant: 'thinking',
      }),
      expect.objectContaining({
        id: 'hub-message-project-group-done-reviewer',
        displayTitle: 'Group @Agent',
        badgeLabel: '@Agent done',
        badgeVariant: 'success',
      }),
    ]);
    // agent-collab resolves to chatviewAgentCollabTranscript via demoWorkbenchTranscripts
    const collabTranscript = resolveDemoWorkbenchTranscript('agent-collab');
    expect(collabTranscript.length).toBeGreaterThan(0);
    expect(collabTranscript[0]).toHaveProperty('id');
  });

  it('exposes the TeamRun fixture without live-runtime claims', () => {
    const store = createWorkbenchDemoStore();
    const teamRun = store.conversations.find((conversation) => conversation.id === TEAMRUN_DEMO_CONVERSATION_ID);
    const transcript = resolveDemoWorkbenchTranscript(TEAMRUN_DEMO_CONVERSATION_ID);

    expect(teamRun).toEqual(expect.objectContaining({
      title: 'TeamRun Fixture',
      model: 'fixture-only',
    }));
    expect(teamRunDemoScenario.fixtureOnly).toBe(true);
    expect(teamRunDemoScenario.claims.realRuntimeExecuted).toBe(false);
    expect(teamRunDemoScenario.claims.liveHubRuntimeVerified).toBe(false);
    expect(teamRunDemoScenario.runtimeProfiles).toHaveLength(2);
    expect(teamRunDemoScenario.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'agent.dispatch',
      'run.agent.route_decision',
      'team.route.decided',
      'run.agent.result',
    ]));
    expect(transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'teamrun-route-list', kind: 'agent_timeline' }),
      expect.objectContaining({ id: 'teamrun-task-step', kind: 'run_step_group' }),
      expect.objectContaining({ id: 'teamrun-delegate', kind: 'route_decision' }),
    ]));
  });

  it('mutates demo transcripts through the runtime store submit path', async () => {
    const runtime = createWorkbenchDemoRuntimeStore();
    const before = runtime.resolveTranscript('builder').length;
    let emits = 0;
    runtime.subscribe(() => {
      emits += 1;
    });

    const result = await runtime.submitComposerIntent({
      conversationId: 'builder',
      text: '继续完善 mock 系统',
      mode: 'code',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    });

    const transcript = runtime.resolveTranscript('builder');
    const userBlock = transcript[transcript.length - 2];
    const agentBlock = transcript[transcript.length - 1];
    expect(result.intentId).toMatch(/^demo-agent-/);
    expect(transcript).toHaveLength(before + 2);
    expect(userBlock).toEqual(expect.objectContaining({
      kind: 'text',
      text: '继续完善 mock 系统',
    }));
    expect(agentBlock).toEqual(expect.objectContaining({
      kind: 'text',
      text: expect.stringContaining('收到，我会继续跟进'),
    }));
    expect(agentBlock).not.toHaveProperty('displayTitle');
    expect(agentBlock).not.toHaveProperty('displayDetail');
    expect(agentBlock).not.toHaveProperty('badgeLabel');
    expect(emits).toBe(1);
  });

  it('mutates demo pins and derives conversation pinned state from current store data', () => {
    const runtime = createWorkbenchDemoRuntimeStore();

    runtime.pinMessage('reviewer', 'reviewer-reply-1', 'Tester');
    const reviewer = runtime.getSnapshot().conversations.find((conversation) => conversation.id === 'reviewer');
    expect(reviewer?.pinnedAnnouncement).toEqual(expect.objectContaining({
      author: 'Tester',
      sourceId: 'reviewer-reply-1',
    }));

    runtime.unpinMessage('reviewer', 'reviewer-reply-1');
    const unpinnedReviewer = runtime.getSnapshot().conversations.find((conversation) => conversation.id === 'reviewer');
    expect(unpinnedReviewer).not.toHaveProperty('pinnedAnnouncement');
  });
});
