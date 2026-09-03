import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatAttachmentContext,
  shouldPreviewBrowserFile,
  browserFilesToAttachments,
  pathBasename,
  type PromptAttachment,
} from '@/utils/attachment';

describe('attachment utils', () => {
  describe('formatBytes', () => {
    it('returns undefined for null/undefined', () => {
      expect(formatBytes(undefined)).toBeUndefined();
      expect(formatBytes(null as any)).toBeUndefined();
    });

    it('formats bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    });
  });

  describe('formatAttachmentContext', () => {
    it('returns empty string for empty array', () => {
      expect(formatAttachmentContext([])).toBe('');
    });

    it('formats a single attachment', () => {
      const attachments: PromptAttachment[] = [
        { id: '1', name: 'test.ts', source: 'browser', size: 1024 },
      ];
      const result = formatAttachmentContext(attachments);
      expect(result).toContain('test.ts');
      expect(result).toContain('1.0 KB');
      expect(result).toContain('Browser file picker');
    });

    it('includes path for desktop attachments', () => {
      const attachments: PromptAttachment[] = [
        { id: '1', name: 'file.ts', source: 'desktop', path: '/home/user/file.ts' },
      ];
      const result = formatAttachmentContext(attachments);
      expect(result).toContain('/home/user/file.ts');
    });
  });

  describe('shouldPreviewBrowserFile', () => {
    it.each([
      ['a.csv', 'text/csv'],
      ['a.tsx', ''],
    ])('returns true for %s', (name, type) => {
      const file = new File([''], name, { type });
      expect(shouldPreviewBrowserFile(file)).toBe(true);
    });

    it('returns false for unknown binary types', () => {
      const file = new File([''], 'image.png', { type: 'image/png' });
      expect(shouldPreviewBrowserFile(file)).toBe(false);
    });
  });

  describe('browserFilesToAttachments', () => {
    it('converts files to attachments', async () => {
      const files = [
        new File(['hello'], 'test.txt', { type: 'text/plain' }),
      ];
      const result = await browserFilesToAttachments(files);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test.txt');
      expect(result[0].source).toBe('browser');
      expect(result[0].contentPreview).toBe('hello');
    });
  });

  describe('pathBasename', () => {
    it('extracts filename from unix path', () => {
      expect(pathBasename('/home/user/file.ts')).toBe('file.ts');
    });

    it('extracts filename from windows path', () => {
      expect(pathBasename('C:\\Users\\Example\\file.ts')).toBe('file.ts');
    });

    it('returns input when no separator', () => {
      expect(pathBasename('file.ts')).toBe('file.ts');
    });
  });
});
