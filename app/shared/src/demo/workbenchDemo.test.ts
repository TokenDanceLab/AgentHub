import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  createWorkbenchDemoStore,
  demoWorkbenchPins,
  resolveDemoWorkbenchTranscript,
} from './workbenchDemo';

describe('workbench v4 demo data source', () => {
  it('derives pinned announcements from demo pins and transcript messages', () => {
    const store = createWorkbenchDemoStore();
    const builder = store.conversations.find((conversation) => conversation.id === 'builder');

    expect(builder?.pinnedAnnouncement).toEqual(expect.objectContaining({
      title: 'Builder',
      sourceId: demoWorkbenchPins[0]?.messageId,
      author: demoWorkbenchPins[0]?.pinnedBy,
    }));
    expect(builder?.pinnedAnnouncement?.content).toContain('收到，我会先做运行隔离和代码定位');
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
});
