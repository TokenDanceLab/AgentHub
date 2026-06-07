import { describe, expect, it, vi } from 'vitest';
import { createDesktopPlatform } from './desktopPlatform';

describe('createDesktopPlatform', () => {
  it('falls back to the shared demo runtime when no active Edge thread is selected', async () => {
    const submitRun = vi.fn();
    const platform = createDesktopPlatform({ submitRun });

    const result = await platform.runs.submitComposerIntent({
      conversationId: 'builder',
      text: 'demo send smoke',
      mode: 'ask',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    });

    expect(result.intentId).toMatch(/^demo-agent-/);
    expect(submitRun).not.toHaveBeenCalled();
  });
});
