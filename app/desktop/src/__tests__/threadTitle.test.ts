import { describe, expect, it } from 'vitest';

import {
  buildAutomaticThreadTitle,
  canAutoRenameThreadTitle,
  getAutomaticThreadTitle,
  isAutomaticThreadTitle,
} from '@/utils/threadTitle';

describe('threadTitle utilities', () => {
  it('builds a compact title from the first meaningful prompt line', () => {
    expect(buildAutomaticThreadTitle('  Fix the desktop chat title after sending a real message.  ')).toBe(
      'Fix the desktop chat title',
    );
  });

  it('strips attachment payloads, markdown fences, and URLs from generated titles', () => {
    expect(buildAutomaticThreadTitle([
      'Review this rendering bug https://example.com/debug',
      '',
      '```tsx',
      '<Broken />',
      '```',
      'Attached files:',
      '-- screenshot.png',
    ].join('\n'))).toBe('Review this rendering bug');
  });

  it('treats empty, Edge default, and runtime names as automatic titles', () => {
    expect(isAutomaticThreadTitle('', ['Codex'])).toBe(true);
    expect(isAutomaticThreadTitle('New Thread', ['Codex'])).toBe(true);
    expect(isAutomaticThreadTitle('ClaudeCode', ['Claude Code'])).toBe(true);
    expect(isAutomaticThreadTitle('Codex', ['Codex'])).toBe(true);
  });

  it('does not replace a human title', () => {
    expect(getAutomaticThreadTitle({
      currentTitle: 'Fix login sync',
      prompt: 'Repair the account button and cloud sync flow',
      runtimeNames: ['Codex'],
    })).toBeNull();
  });

  it('returns a replacement title for a placeholder thread title', () => {
    expect(getAutomaticThreadTitle({
      currentTitle: 'New Thread',
      prompt: 'Repair message ordering after sending from the composer',
      runtimeNames: ['Codex'],
    })).toBe('Repair message ordering after');
  });

  it('does not auto rename a locally empty thread after the user edits its title first', () => {
    expect(canAutoRenameThreadTitle({
      createdThreadForPrompt: false,
      locallyCreatedEmptyThread: true,
      manuallyNamedThread: true,
      currentThreadItemCount: 0,
    })).toBe(false);
  });
});
