import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  createWorkbenchDemoRuntimeStore,
  createWorkbenchDemoStore,
  demoWorkbenchPins,
  resolveDemoWorkbenchTranscript,
} from './workbenchDemo';
import { TEAMRUN_DEMO_CONVERSATION_ID, teamRunDemoScenario } from './teamrunDemo';

describe('workbench v4 demo data source', () => {
  it('derives the Builder pinned announcement from the design demo summary', () => {
    const store = createWorkbenchDemoStore();
    const builder = store.conversations.find((conversation) => conversation.id === 'builder');

    expect(builder?.pinnedAnnouncement).toEqual(expect.objectContaining({
      title: 'Builder',
      sourceId: demoWorkbenchPins[0]?.messageId,
      author: demoWorkbenchPins[0]?.pinnedBy,
    }));
    expect(builder?.pinnedAnnouncement?.content).toContain('前端重构任务已置顶');
    expect(builder?.pinnedAnnouncement?.content).toContain('Reviewer 和 Deployer 后续跟进验收');
  });

  it('keeps non-pinned demo conversations free of pinned state', () => {
    const store = createWorkbenchDemoStore();
    const reviewer = store.conversations.find((conversation) => conversation.id === 'reviewer');

    expect(reviewer).not.toHaveProperty('pinnedAnnouncement');
  });

  it('resolves per-conversation transcripts with a fallback preview transcript', () => {
    expect(resolveDemoWorkbenchTranscript(WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID)[0]).toEqual(expect.objectContaining({
      id: 'builder-user-1',
    }));
    expect(resolveDemoWorkbenchTranscript('reviewer')[0]).toEqual(expect.objectContaining({
      id: 'reviewer-user-1',
      kind: 'text',
    }));
  });

  it('exposes the ByteDance TeamRun fixture without live-runtime claims', () => {
    const store = createWorkbenchDemoStore();
    const teamRun = store.conversations.find((conversation) => conversation.id === TEAMRUN_DEMO_CONVERSATION_ID);
    const transcript = resolveDemoWorkbenchTranscript(TEAMRUN_DEMO_CONVERSATION_ID);

    expect(teamRun).toEqual(expect.objectContaining({
      title: 'ByteDance TeamRun',
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
    expect(result.intentId).toMatch(/^demo-agent-/);
    expect(transcript).toHaveLength(before + 2);
    expect(transcript.at(-2)).toEqual(expect.objectContaining({
      kind: 'text',
      text: '继续完善 mock 系统',
    }));
    expect(transcript.at(-1)).toEqual(expect.objectContaining({
      kind: 'text',
      text: expect.stringContaining('已收到 mock 输入'),
    }));
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
