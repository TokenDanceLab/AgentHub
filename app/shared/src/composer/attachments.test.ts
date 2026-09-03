// real_tested=true — computeFileHash runs the real webcrypto SHA-256 in jsdom; no crypto mocking.
import { describe, expect, it, vi } from 'vitest';

import {
  attachmentRefToComposerAttachment,
  browserFilesToComposerAttachments,
  computeFileHash,
  desktopPathsToComposerAttachments,
  formatComposerAttachmentContext,
  formatComposerAttachmentSize,
  formatComposerPromptWithAttachments,
  shouldPreviewComposerFile,
  shouldPreviewComposerFileName,
} from './attachments';
import type { AttachmentRef, ComposerAttachment } from './types';

const MAX_COMPOSER_ATTACHMENT_PREVIEW = 12_000;
const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA256_HELLO = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function makeFile(contents = 'hello', name = 'hello.txt', type = 'text/plain'): File {
  return new File([contents], name, { type });
}

function makeRef(overrides: Partial<AttachmentRef> = {}): AttachmentRef {
  return {
    id: 'att-1',
    name: 'stored.txt',
    size: 1234,
    mime_type: 'text/plain',
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<ComposerAttachment> = {}): ComposerAttachment {
  return {
    id: 'att-1',
    name: 'hello.txt',
    ...overrides,
  };
}

describe('computeFileHash', () => {
  it('hashes "hello" to the canonical SHA-256 digest', async () => {
    await expect(computeFileHash(makeFile('hello', 'hello.txt'))).resolves.toBe(SHA256_HELLO);
  });

  it('hashes an empty file to the SHA-256 of the empty string', async () => {
    await expect(computeFileHash(makeFile('', 'empty.txt'))).resolves.toBe(SHA256_EMPTY);
  });

  it('hashes "abc" to the canonical SHA-256 digest', async () => {
    await expect(computeFileHash(makeFile('abc', 'abc.txt'))).resolves.toBe(SHA256_ABC);
  });

  it('returns a deterministic 64-char lowercase hex digest for unicode content', async () => {
    const file = makeFile('héllo 世界 🌍', 'unicode.txt');
    const firstDigest = await computeFileHash(file);
    const secondDigest = await computeFileHash(file);

    expect(firstDigest).toBe(secondDigest);
    expect(firstDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes binary content into a distinct digest', async () => {
    const binaryFile = new File([new Uint8Array([0, 1, 2, 3, 254, 255])], 'binary.bin');
    const digest = await computeFileHash(binaryFile);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(SHA256_EMPTY);
    expect(digest).not.toBe(SHA256_HELLO);
  });
});

describe('attachmentRefToComposerAttachment', () => {
  const file = makeFile('hello', 'local-name.txt');

  it('maps every ref field onto the attachment', () => {
    const ref = makeRef({ original_name: 'server-name.txt' });
    const attachment = attachmentRefToComposerAttachment(ref, file);

    expect(attachment.id).toBe('att-1');
    expect(attachment.size).toBe(1234);
    expect(attachment.mime).toBe('text/plain');
    expect(attachment.attachmentRef).toBe(ref);
  });

  it('prefers the server original_name over the local file name', () => {
    const attachment = attachmentRefToComposerAttachment(
      makeRef({ original_name: 'server-name.txt' }),
      file,
    );

    expect(attachment.name).toBe('server-name.txt');
  });

  it('falls back to the local file name when original_name is missing', () => {
    const attachment = attachmentRefToComposerAttachment(makeRef(), file);

    expect(attachment.name).toBe('local-name.txt');
  });

  it('treats an empty original_name as missing', () => {
    const attachment = attachmentRefToComposerAttachment(makeRef({ original_name: '' }), file);

    expect(attachment.name).toBe('local-name.txt');
  });

  it('defaults the source to browser', () => {
    const attachment = attachmentRefToComposerAttachment(makeRef(), file);

    expect(attachment.source).toBe('browser');
  });

  it('honours an explicit desktop source', () => {
    const attachment = attachmentRefToComposerAttachment(makeRef(), file, 'desktop');

    expect(attachment.source).toBe('desktop');
  });
});

describe('formatComposerAttachmentSize', () => {
  it.each([[undefined], [null as unknown as number | undefined]])(
    'returns undefined for %s input',
    (size) => {
      expect(formatComposerAttachmentSize(size)).toBeUndefined();
    },
  );

  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1.0 MB'],
    [5.75 * 1024 * 1024, '5.8 MB'],
    [-512, '-512 B'],
  ])('formats %s bytes as %s', (size, expected) => {
    expect(formatComposerAttachmentSize(size)).toBe(expected);
  });
});

describe('formatComposerAttachmentContext', () => {
  it('returns an empty string for no attachments', () => {
    expect(formatComposerAttachmentContext([])).toBe('');
  });

  it('renders a minimal browser attachment', () => {
    expect(formatComposerAttachmentContext([makeAttachment()])).toBe(
      'Attached files:\n1. hello.txt\n   Source: Browser file picker',
    );
  });

  it('treats an undefined source as the browser picker', () => {
    expect(formatComposerAttachmentContext([makeAttachment({ source: undefined })])).toBe(
      'Attached files:\n1. hello.txt\n   Source: Browser file picker',
    );
  });

  it('labels desktop attachments as the desktop file picker', () => {
    expect(formatComposerAttachmentContext([makeAttachment({ source: 'desktop' })])).toBe(
      'Attached files:\n1. hello.txt\n   Source: Desktop file picker',
    );
  });

  it('includes the path line when a path is set', () => {
    expect(formatComposerAttachmentContext([makeAttachment({ path: '/tmp/notes.md' })])).toBe(
      'Attached files:\n1. hello.txt\n   Path: /tmp/notes.md\n   Source: Browser file picker',
    );
  });

  it('includes the formatted size line', () => {
    expect(formatComposerAttachmentContext([makeAttachment({ size: 512 })])).toContain(
      '   Size: 512 B',
    );
  });

  it('omits the size line when size is undefined', () => {
    expect(formatComposerAttachmentContext([makeAttachment()])).not.toContain('Size');
  });

  it('includes the MIME line when mime is set', () => {
    expect(formatComposerAttachmentContext([makeAttachment({ mime: 'application/json' })])).toContain(
      '   MIME: application/json',
    );
  });

  it('omits the MIME line when mime is undefined', () => {
    expect(formatComposerAttachmentContext([makeAttachment()])).not.toContain('MIME');
  });

  it('renders an untruncated content preview with indented lines', () => {
    expect(
      formatComposerAttachmentContext([makeAttachment({ contentPreview: 'line1\nline2' })]),
    ).toBe(
      [
        'Attached files:',
        '1. hello.txt',
        '   Source: Browser file picker',
        '   Content preview:',
        '   line1',
        '   line2',
      ].join('\n'),
    );
  });

  it('marks truncated content previews', () => {
    expect(
      formatComposerAttachmentContext([makeAttachment({ contentPreview: 'cut off', truncated: true })]),
    ).toContain('   Content preview (truncated):');
  });

  it('normalizes CRLF preview content onto single lines', () => {
    expect(
      formatComposerAttachmentContext([makeAttachment({ contentPreview: 'alpha\r\nbeta' })]),
    ).toBe(
      [
        'Attached files:',
        '1. hello.txt',
        '   Source: Browser file picker',
        '   Content preview:',
        '   alpha',
        '   beta',
      ].join('\n'),
    );
  });

  it('numbers multiple attachments in order', () => {
    const context = formatComposerAttachmentContext([
      makeAttachment({ id: 'a', name: 'a.txt' }),
      makeAttachment({ id: 'b', name: 'b.txt', source: 'desktop' }),
    ]);

    expect(context).toBe(
      [
        'Attached files:',
        '1. a.txt',
        '   Source: Browser file picker',
        '2. b.txt',
        '   Source: Desktop file picker',
      ].join('\n'),
    );
  });

  it('renders the full kitchen-sink attachment', () => {
    const context = formatComposerAttachmentContext([
      makeAttachment({
        name: 'notes.md',
        source: 'desktop',
        path: '/tmp/notes.md',
        size: 2048,
        mime: 'text/markdown',
        contentPreview: 'first line\nsecond line',
        truncated: true,
      }),
    ]);

    expect(context).toBe(
      [
        'Attached files:',
        '1. notes.md',
        '   Path: /tmp/notes.md',
        '   Source: Desktop file picker',
        '   Size: 2.0 KB',
        '   MIME: text/markdown',
        '   Content preview (truncated):',
        '   first line',
        '   second line',
      ].join('\n'),
    );
  });
});

describe('formatComposerPromptWithAttachments', () => {
  it('returns an empty string for empty text and no attachments', () => {
    expect(formatComposerPromptWithAttachments('', [])).toBe('');
  });

  it('trims whitespace-only text down to an empty string', () => {
    expect(formatComposerPromptWithAttachments('   \n\t ', [])).toBe('');
  });

  it('joins trimmed text and attachment context with a blank line', () => {
    expect(formatComposerPromptWithAttachments('  hello world  ', [makeAttachment()])).toBe(
      'hello world\n\nAttached files:\n1. hello.txt\n   Source: Browser file picker',
    );
  });

  it('returns just the attachment context when the text is empty', () => {
    expect(formatComposerPromptWithAttachments('', [makeAttachment()])).toBe(
      'Attached files:\n1. hello.txt\n   Source: Browser file picker',
    );
  });

  it('returns just the attachment context when the text is whitespace-only', () => {
    expect(formatComposerPromptWithAttachments('\n\n  ', [makeAttachment()])).toBe(
      'Attached files:\n1. hello.txt\n   Source: Browser file picker',
    );
  });
});

describe('shouldPreviewComposerFile', () => {
  it.each([
    ['weird.unknown', 'text/plain'],
    ['notes.md', 'application/octet-stream'],
    ['notes.md', ''],
  ])('previews %s with mime %s', (name, mime) => {
    expect(shouldPreviewComposerFile(makeFile('x', name, mime))).toBe(true);
  });

  it('does not preview files with neither a text MIME nor a matching name', () => {
    expect(shouldPreviewComposerFile(makeFile('x', 'data.unknown', 'application/octet-stream'))).toBe(
      false,
    );
  });
});

describe('shouldPreviewComposerFileName', () => {
  it.each([
    ['weird.unknown', 'text/plain'],
    ['notes.md', undefined],
    ['NOTES.MD', undefined],
    ['trace.jsonl', undefined],
    ['server.log', undefined],
    ['data.json', 'application/octet-stream'],
  ])('accepts %s as previewable (mime=%s)', (name, mime) => {
    if (mime === undefined) {
      expect(shouldPreviewComposerFileName(name)).toBe(true);
    } else {
      expect(shouldPreviewComposerFileName(name, mime)).toBe(true);
    }
  });

  it.each([
    ['blob.unknown', undefined],
    ['archive.tar.gz', undefined],
    ['Dockerfile', undefined],
    ['.env', undefined],
    ['blob.unknown', 'application/octet-stream'],
  ])('rejects %s as previewable (mime=%s)', (name, mime) => {
    if (mime === undefined) {
      expect(shouldPreviewComposerFileName(name)).toBe(false);
    } else {
      expect(shouldPreviewComposerFileName(name, mime)).toBe(false);
    }
  });
});

describe('browserFilesToComposerAttachments', () => {
  it('returns an empty list for no files', async () => {
    await expect(browserFilesToComposerAttachments([])).resolves.toEqual([]);
  });

  it('builds a preview attachment with id, metadata and the file reference', async () => {
    const file = makeFile('hello', 'notes.md', 'text/markdown');
    const [first] = await browserFilesToComposerAttachments([file]);

    expect(first?.id).toMatch(/^browser-\d+-0-notes\.md$/);
    expect(first).toMatchObject({
      name: 'notes.md',
      source: 'browser',
      size: 5,
      mime: 'text/markdown',
      contentPreview: 'hello',
      truncated: false,
      file,
    });
  });

  it('truncates content beyond the preview limit and flags it', async () => {
    const longContent = 'a'.repeat(MAX_COMPOSER_ATTACHMENT_PREVIEW + 1);
    const [first] = await browserFilesToComposerAttachments([makeFile(longContent, 'long.txt')]);

    expect(first?.contentPreview).toHaveLength(MAX_COMPOSER_ATTACHMENT_PREVIEW);
    expect(first?.truncated).toBe(true);
  });

  it('does not flag content exactly at the preview limit', async () => {
    const exactContent = 'b'.repeat(MAX_COMPOSER_ATTACHMENT_PREVIEW);
    const [first] = await browserFilesToComposerAttachments([makeFile(exactContent, 'exact.txt')]);

    expect(first?.contentPreview).toBe(exactContent);
    expect(first?.truncated).toBe(false);
  });

  it('skips the preview for non-previewable files', async () => {
    const file = makeFile('bytes', 'archive.bin', 'application/octet-stream');
    const [first] = await browserFilesToComposerAttachments([file]);

    expect(first?.contentPreview).toBeUndefined();
    expect(first?.mime).toBe('application/octet-stream');
  });

  it('omits preview fields for empty text content', async () => {
    const [first] = await browserFilesToComposerAttachments([
      makeFile('', 'empty.md', 'text/markdown'),
    ]);

    expect(first).not.toHaveProperty('contentPreview');
    expect(first).not.toHaveProperty('truncated');
  });

  it('swallows text() read failures and keeps the attachment', async () => {
    const brokenFile = {
      name: 'broken.txt',
      type: 'text/plain',
      size: 3,
      text: () => Promise.reject(new Error('read failed')),
    } as unknown as File;

    const [first] = await browserFilesToComposerAttachments([brokenFile]);

    expect(first?.name).toBe('broken.txt');
    expect(first?.contentPreview).toBeUndefined();
  });

  it('skips the preview when file.text is unavailable', async () => {
    const legacyFile = {
      name: 'legacy.txt',
      type: 'text/plain',
      size: 3,
    } as unknown as File;

    const [first] = await browserFilesToComposerAttachments([legacyFile]);

    expect(first?.contentPreview).toBeUndefined();
  });

  it('omits the mime field when the file type is empty', async () => {
    const [first] = await browserFilesToComposerAttachments([makeFile('a,b', 'data.csv', '')]);

    expect(first).not.toHaveProperty('mime');
    expect(first?.contentPreview).toBe('a,b');
  });

  it('indexes multiple files in order', async () => {
    const [first, second] = await browserFilesToComposerAttachments([
      makeFile('one', 'a.txt'),
      makeFile('two', 'b.txt'),
    ]);

    expect(first?.id).toMatch(/^browser-\d+-0-a\.txt$/);
    expect(second?.id).toMatch(/^browser-\d+-1-b\.txt$/);
    expect(first?.contentPreview).toBe('one');
    expect(second?.contentPreview).toBe('two');
  });
});

describe('desktopPathsToComposerAttachments', () => {
  it('returns an empty list for no paths', async () => {
    await expect(desktopPathsToComposerAttachments([], vi.fn())).resolves.toEqual([]);
  });

  it('reads previewable files and builds a desktop attachment', async () => {
    const readText = vi.fn().mockResolvedValue('file contents');
    const [first] = await desktopPathsToComposerAttachments(['/tmp/notes.md'], readText);

    expect(readText).toHaveBeenCalledWith('/tmp/notes.md');
    expect(first?.id).toMatch(/^desktop-\d+-0-notes\.md$/);
    expect(first).toMatchObject({
      name: 'notes.md',
      source: 'desktop',
      path: '/tmp/notes.md',
      contentPreview: 'file contents',
      truncated: false,
    });
    expect(first).not.toHaveProperty('mime');
  });

  it('extracts the basename from windows-style paths', async () => {
    const readText = vi.fn().mockResolvedValue('win');
    const [first] = await desktopPathsToComposerAttachments(
      ['C:\\Users\\dev\\notes.md'],
      readText,
    );

    expect(first?.name).toBe('notes.md');
    expect(first?.path).toBe('C:\\Users\\dev\\notes.md');
  });

  it('keeps plain names without separators unchanged', async () => {
    const readText = vi.fn().mockResolvedValue('plain');
    const [first] = await desktopPathsToComposerAttachments(['notes.md'], readText);

    expect(first?.name).toBe('notes.md');
  });

  it('falls back to the raw path when it has no basename', async () => {
    const readText = vi.fn();
    const [first] = await desktopPathsToComposerAttachments(['/'], readText);

    expect(first?.name).toBe('/');
    expect(readText).not.toHaveBeenCalled();
  });

  it('truncates content beyond the preview limit and flags it', async () => {
    const longContent = 'x'.repeat(MAX_COMPOSER_ATTACHMENT_PREVIEW + 1);
    const readText = vi.fn().mockResolvedValue(longContent);
    const [first] = await desktopPathsToComposerAttachments(['/tmp/long.txt'], readText);

    expect(first?.contentPreview).toHaveLength(MAX_COMPOSER_ATTACHMENT_PREVIEW);
    expect(first?.truncated).toBe(true);
  });

  it('swallows readText failures and keeps the attachment', async () => {
    const readText = vi.fn().mockRejectedValue(new Error('EACCES'));
    const [first] = await desktopPathsToComposerAttachments(['/tmp/notes.md'], readText);

    expect(first?.name).toBe('notes.md');
    expect(first?.contentPreview).toBeUndefined();
  });

  it('skips readText for non-previewable names', async () => {
    const readText = vi.fn().mockResolvedValue('never read');
    const [first] = await desktopPathsToComposerAttachments(['/tmp/archive.tar.gz'], readText);

    expect(readText).not.toHaveBeenCalled();
    expect(first?.contentPreview).toBeUndefined();
    expect(first?.name).toBe('archive.tar.gz');
  });

  it('indexes multiple paths in order', async () => {
    const readText = vi.fn().mockResolvedValue('content');
    const [first, second] = await desktopPathsToComposerAttachments(
      ['/tmp/a.md', '/tmp/b.txt'],
      readText,
    );

    expect(first?.id).toMatch(/^desktop-\d+-0-a\.md$/);
    expect(second?.id).toMatch(/^desktop-\d+-1-b\.txt$/);
    expect(readText).toHaveBeenCalledTimes(2);
  });
});
