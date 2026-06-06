import { describe, expect, it } from 'vitest';
import {
  browserFilesToComposerAttachments,
  formatComposerAttachmentContext,
  formatComposerAttachmentSize,
  formatComposerPromptWithAttachments,
  shouldPreviewComposerFile,
} from './attachments';
import type { ComposerAttachment } from './types';

describe('composer attachments', () => {
  it('formats sizes and attachment context for Edge prompts', () => {
    const attachments: ComposerAttachment[] = [{
      id: 'attachment-1',
      name: 'notes.txt',
      source: 'browser',
      size: 1536,
      mime: 'text/plain',
      contentPreview: 'alpha\nbeta',
    }];

    expect(formatComposerAttachmentSize(1536)).toBe('1.5 KB');
    expect(formatComposerAttachmentContext(attachments)).toContain('notes.txt');
    expect(formatComposerAttachmentContext(attachments)).toContain('Browser file picker');
    expect(formatComposerAttachmentContext(attachments)).toContain('alpha');
    expect(formatComposerPromptWithAttachments('Read this', attachments)).toContain('Read this\n\nAttached files:');
  });

  it('supports attachment-only prompts', () => {
    const attachments: ComposerAttachment[] = [{
      id: 'attachment-1',
      name: 'notes.txt',
      source: 'browser',
    }];

    expect(formatComposerPromptWithAttachments('', attachments)).toMatch(/^Attached files:/);
  });

  it('converts browser files and previews text-like files', async () => {
    const textFile = new File(['attachment-token'], 'notes.md', { type: 'text/markdown' });
    const imageFile = new File(['raw'], 'image.png', { type: 'image/png' });

    expect(shouldPreviewComposerFile(textFile)).toBe(true);
    expect(shouldPreviewComposerFile(imageFile)).toBe(false);

    const attachments = await browserFilesToComposerAttachments([textFile]);
    expect(attachments[0]).toEqual(expect.objectContaining({
      name: 'notes.md',
      source: 'browser',
      contentPreview: 'attachment-token',
    }));
  });
});
