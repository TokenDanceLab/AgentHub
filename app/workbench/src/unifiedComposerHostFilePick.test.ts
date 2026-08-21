import { describe, expect, it, vi } from 'vitest';
import {
  planComposerFilePick,
  planOpenFilePicker,
  resolveComposerFilePickAttachments,
  resolveComposerFilePickChange,
  resolveComposerOpenFilePicker,
  resolveOpenFilePickerAttachments,
} from './unifiedComposerHostFilePick';

describe('unifiedComposerHostFilePick', () => {
  const file = new File(['x'], 'a.txt', { type: 'text/plain' });
  const list = {
    0: file,
    length: 1,
    item: (index: number) => (index === 0 ? file : null),
    [Symbol.iterator]: function* iterator() {
      yield file;
    },
  } as unknown as FileList;

  it('plans and resolves file pick / open-picker routes', async () => {
    expect(planComposerFilePick({
      fileList: null,
      hasNativePicker: true,
    })).toEqual({ kind: 'native' });
    expect(planComposerFilePick({
      fileList: null,
      hasNativePicker: false,
    })).toEqual({ kind: 'noop' });
    expect(planComposerFilePick({
      fileList: list,
      hasNativePicker: false,
    })).toEqual({ kind: 'browser', files: [file] });

    expect(planOpenFilePicker(true)).toEqual({ kind: 'native' });
    expect(planOpenFilePicker(false)).toEqual({ kind: 'web-input' });

    const nativeAttachments = await resolveComposerFilePickAttachments({
      plan: { kind: 'native' },
      onPickLocalAttachments: async () => [{
        id: 'a1',
        name: 'desk.txt',
        mime: 'text/plain',
        size: 1,
      }],
      browserFilesToAttachments: vi.fn(async () => []),
    });
    expect(nativeAttachments).toHaveLength(1);

    const cancelled = await resolveComposerFilePickAttachments({
      plan: { kind: 'native' },
      onPickLocalAttachments: async () => {
        throw new Error('cancel');
      },
      browserFilesToAttachments: vi.fn(async () => []),
    });
    expect(cancelled).toEqual([]);

    const browserAttachments = await resolveComposerFilePickAttachments({
      plan: { kind: 'browser', files: [file] },
      browserFilesToAttachments: async (files) => files.map((entry, index) => ({
        id: `b${index}`,
        name: entry.name,
        mime: entry.type,
        size: entry.size,
      })),
    });
    expect(browserAttachments[0]?.name).toBe('a.txt');

    expect(await resolveOpenFilePickerAttachments({
      plan: { kind: 'web-input' },
    })).toBeNull();
    expect(await resolveOpenFilePickerAttachments({
      plan: { kind: 'native' },
      onPickLocalAttachments: async () => [],
    })).toEqual([]);
  });

  it('resolves file-input change into host dispatch payloads', async () => {
    expect(await resolveComposerFilePickChange({
      fileList: null,
      hasNativePicker: false,
      browserFilesToAttachments: vi.fn(async () => []),
    })).toEqual({ kind: 'noop' });

    const browser = await resolveComposerFilePickChange({
      fileList: list,
      hasNativePicker: false,
      browserFilesToAttachments: async (files) => files.map((entry, index) => ({
        id: `b${index}`,
        name: entry.name,
        mime: entry.type,
        size: entry.size,
      })),
    });
    expect(browser).toEqual({
      kind: 'attachments',
      attachments: [{
        id: 'b0',
        name: 'a.txt',
        mime: 'text/plain',
        size: 1,
      }],
      resetInput: true,
    });

    const native = await resolveComposerFilePickChange({
      fileList: list,
      hasNativePicker: true,
      onPickLocalAttachments: async () => [{
        id: 'n1',
        name: 'desk.txt',
        mime: 'text/plain',
        size: 2,
      }],
      browserFilesToAttachments: vi.fn(async () => []),
    });
    expect(native).toEqual({
      kind: 'attachments',
      attachments: [{
        id: 'n1',
        name: 'desk.txt',
        mime: 'text/plain',
        size: 2,
      }],
      resetInput: true,
    });
  });

  it('resolves attach-button open into host dispatch payloads', async () => {
    expect(await resolveComposerOpenFilePicker({
      hasNativePicker: false,
    })).toEqual({ kind: 'web-input' });

    expect(await resolveComposerOpenFilePicker({
      hasNativePicker: true,
      onPickLocalAttachments: async () => [{
        id: 'n1',
        name: 'desk.txt',
        mime: 'text/plain',
        size: 2,
      }],
    })).toEqual({
      kind: 'attachments',
      attachments: [{
        id: 'n1',
        name: 'desk.txt',
        mime: 'text/plain',
        size: 2,
      }],
    });

    expect(await resolveComposerOpenFilePicker({
      hasNativePicker: true,
      onPickLocalAttachments: async () => {
        throw new Error('cancel');
      },
    })).toEqual({
      kind: 'attachments',
      attachments: [],
    });
  });
});
