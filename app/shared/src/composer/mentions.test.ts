import { describe, expect, it } from 'vitest';
import { formatComposerMentionContext, formatComposerPromptWithContext } from './mentions';
import type { ComposerAttachment, ComposerMention } from './types';

describe('composer mentions', () => {
  it('formats structured @Agent context for Edge prompts', () => {
    const mentions: ComposerMention[] = [{
      id: 'builder',
      label: 'Builder',
      description: '代码实现',
      runtimeId: 'claude-code',
      model: 'glm-5.1',
      status: 'available',
    }];

    const context = formatComposerMentionContext(mentions);
    expect(context).toContain('Mentioned agents:');
    expect(context).toContain('Builder (id: builder)');
    expect(context).toContain('Model: glm-5.1');
  });

  it('combines text, @Agent context, and attachment context', () => {
    const mentions: ComposerMention[] = [{ id: 'reviewer', label: 'Reviewer' }];
    const attachments: ComposerAttachment[] = [{
      id: 'attachment-1',
      name: 'notes.txt',
      source: 'browser',
      contentPreview: 'attachment-token',
    }];

    const prompt = formatComposerPromptWithContext('Review this', attachments, mentions);
    expect(prompt).toContain('Review this\n\nMentioned agents:');
    expect(prompt).toContain('Reviewer (id: reviewer)');
    expect(prompt).toContain('Attached files:');
    expect(prompt).toContain('attachment-token');
  });
});
