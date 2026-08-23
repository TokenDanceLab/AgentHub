import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from './unifiedComposerHelpers';

vi.mock('@shared/composer', async (importOriginal) => {
  const original = await importOriginal<typeof import('@shared/composer')>();
  return { ...original, browserFilesToComposerAttachments: vi.fn() };
});

import type { ComposerAttachment } from '@shared/composer';
import { browserFilesToComposerAttachments } from '@shared/composer';
import {
  handleDocumentDragLeave,
  handleDocumentDragOver,
  handleDocumentDrop,
  isFileDropInsideComposer,
  type ComposerDocumentFileDropCallbacks,
} from './composerDocumentFileDrop';

/* #1822/#1853: document-level file-drop routing — drops outside the
   composer form become attachments instead of opening in the browser. */

interface DataTransferLike {
  types: string[];
  files: File[];
}

function dragEvent(
  type: string,
  init: { dataTransfer?: DataTransferLike | null; relatedTarget?: Node | null } = {},
): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  if (init.dataTransfer) Object.assign(event, { dataTransfer: init.dataTransfer });
  if (init.relatedTarget !== undefined) Object.assign(event, { relatedTarget: init.relatedTarget });
  return event;
}

function file(name: string, size = 1024): File {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function makeCallbacks(
  overrides: Partial<ComposerDocumentFileDropCallbacks> = {},
): ComposerDocumentFileDropCallbacks {
  return {
    dispatchComposer: vi.fn(),
    onToast: vi.fn(),
    onDraggingChange: vi.fn(),
    getCurrentConversationId: vi.fn(() => 'c1'),
    ...overrides,
  };
}

function targetInsideComposer(): HTMLElement {
  const form = document.createElement('form');
  form.setAttribute('data-composer-form', '');
  const chip = document.createElement('div');
  form.appendChild(chip);
  document.body.appendChild(form);
  return chip;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('isFileDropInsideComposer', () => {
  it('detects targets inside [data-composer-form]', () => {
    const chip = targetInsideComposer();
    expect(isFileDropInsideComposer(chip)).toBe(true);
  });

  it('returns false for plain elements, document and null', () => {
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    expect(isFileDropInsideComposer(outside)).toBe(false);
    expect(isFileDropInsideComposer(document)).toBe(false);
    expect(isFileDropInsideComposer(null)).toBe(false);
  });
});

describe('handleDocumentDragOver', () => {
  it('prevents the default and enables the drop overlay for Files outside the composer', () => {
    const cb = makeCallbacks();
    const event = dragEvent('dragover', { dataTransfer: { types: ['Files'], files: [] } });
    handleDocumentDragOver(cb, event);
    expect(event.defaultPrevented).toBe(true);
    expect(cb.onDraggingChange).toHaveBeenCalledWith(true);
  });

  it('leaves dragging off when the drag target is inside the composer', () => {
    const cb = makeCallbacks();
    const chip = targetInsideComposer();
    const event = dragEvent('dragover', { dataTransfer: { types: ['Files'], files: [] } });
    chip.dispatchEvent(event);
    handleDocumentDragOver(cb, event);
    expect(event.defaultPrevented).toBe(false);
    expect(cb.onDraggingChange).toHaveBeenCalledWith(false);
  });

  it('ignores drags without a Files payload', () => {
    const cb = makeCallbacks();
    const event = dragEvent('dragover', { dataTransfer: { types: ['text/plain'], files: [] } });
    handleDocumentDragOver(cb, event);
    expect(event.defaultPrevented).toBe(false);
    expect(cb.onDraggingChange).not.toHaveBeenCalled();
  });
});

describe('handleDocumentDragLeave', () => {
  it('disables the overlay when the pointer leaves the document', () => {
    const cb = makeCallbacks({ onDraggingChange: vi.fn() });
    handleDocumentDragLeave(cb, dragEvent('dragleave', { relatedTarget: null }));
    expect(cb.onDraggingChange).toHaveBeenCalledWith(false);
  });

  it('disables the overlay when the related target was detached', () => {
    const cb = makeCallbacks();
    const detached = document.createElement('div');
    handleDocumentDragLeave(cb, dragEvent('dragleave', { relatedTarget: detached }));
    expect(cb.onDraggingChange).toHaveBeenCalledWith(false);
  });

  it('keeps the overlay while the pointer stays inside the document', () => {
    const cb = makeCallbacks();
    const inside = document.createElement('div');
    document.body.appendChild(inside);
    handleDocumentDragLeave(cb, dragEvent('dragleave', { relatedTarget: inside }));
    expect(cb.onDraggingChange).not.toHaveBeenCalled();
  });
});

describe('handleDocumentDrop', () => {
  it('ignores drops without a Files payload', () => {
    const cb = makeCallbacks();
    const event = dragEvent('drop', { dataTransfer: { types: ['text/plain'], files: [] } });
    handleDocumentDrop(cb, event);
    expect(event.defaultPrevented).toBe(false);
    expect(cb.onToast).not.toHaveBeenCalled();
    expect(cb.onDraggingChange).toHaveBeenCalledWith(false);
  });

  it('ignores drops inside the composer form', () => {
    const cb = makeCallbacks();
    const chip = targetInsideComposer();
    const event = dragEvent('drop', { dataTransfer: { types: ['Files'], files: [file('a.pdf')] } });
    chip.dispatchEvent(event);
    handleDocumentDrop(cb, event);
    expect(event.defaultPrevented).toBe(false);
    expect(cb.onToast).not.toHaveBeenCalled();
  });

  it('prevents the default for an empty file list but dispatches nothing', () => {
    const cb = makeCallbacks();
    const event = dragEvent('drop', { dataTransfer: { types: ['Files'], files: [] } });
    handleDocumentDrop(cb, event);
    expect(event.defaultPrevented).toBe(true);
    expect(cb.dispatchComposer).not.toHaveBeenCalled();
  });

  it('routes accepted files to composer attachments', async () => {
    const cb = makeCallbacks();
    vi.mocked(browserFilesToComposerAttachments).mockResolvedValue([
      { id: 'a1', name: 'design.pdf', size: 1024 } as ComposerAttachment,
    ]);
    const event = dragEvent('drop', { dataTransfer: { types: ['Files'], files: [file('design.pdf', 1024)] } });
    handleDocumentDrop(cb, event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(cb.dispatchComposer).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'addAttachment', attachment: expect.objectContaining({ id: 'a1' }) }),
      );
    });
    expect(cb.onToast).not.toHaveBeenCalled();
  });

  it('toasts and dispatches nothing when every file is oversized', () => {
    const cb = makeCallbacks();
    const event = dragEvent('drop', {
      dataTransfer: { types: ['Files'], files: [file('huge.bin', MAX_ATTACHMENT_BYTES + 1)] },
    });
    handleDocumentDrop(cb, event);
    expect(event.defaultPrevented).toBe(true);
    expect(cb.onToast).toHaveBeenCalledOnce();
    expect(cb.dispatchComposer).not.toHaveBeenCalled();
  });

  it('toasts for rejected files while still routing accepted ones', async () => {
    const cb = makeCallbacks();
    vi.mocked(browserFilesToComposerAttachments).mockResolvedValue([
      { id: 'a2', name: 'ok.png', size: 512 } as ComposerAttachment,
    ]);
    const event = dragEvent('drop', {
      dataTransfer: {
        types: ['Files'],
        files: [file('ok.png', 512), file('huge.bin', MAX_ATTACHMENT_BYTES + 1)],
      },
    });
    handleDocumentDrop(cb, event);
    expect(cb.onToast).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(cb.dispatchComposer).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'addAttachment', attachment: expect.objectContaining({ id: 'a2' }) }),
      );
    });
  });

  it('#1853 review: drops the attachment when the conversation changed mid-conversion', async () => {
    let currentConversation = 'c1';
    const cb = makeCallbacks({ getCurrentConversationId: () => currentConversation });
    let resolveConversion!: (attachments: ComposerAttachment[]) => void;
    vi.mocked(browserFilesToComposerAttachments).mockReturnValue(
      new Promise<ComposerAttachment[]>((resolve) => {
        resolveConversion = resolve;
      }),
    );
    const event = dragEvent('drop', { dataTransfer: { types: ['Files'], files: [file('a.pdf')] } });
    handleDocumentDrop(cb, event);
    expect(event.defaultPrevented).toBe(true);

    // Switch conversations while File.text() is still pending.
    currentConversation = 'c2';
    resolveConversion([{ id: 'a1', name: 'a.pdf', size: 1024 } as ComposerAttachment]);
    await Promise.resolve();
    await Promise.resolve();

    expect(cb.dispatchComposer).not.toHaveBeenCalled();
  });

  it('#1853 review: dispatches when the conversation stayed the same', async () => {
    let currentConversation = 'c1';
    const cb = makeCallbacks({ getCurrentConversationId: () => currentConversation });
    vi.mocked(browserFilesToComposerAttachments).mockResolvedValue([
      { id: 'a3', name: 'same.pdf', size: 2048 } as ComposerAttachment,
    ]);
    handleDocumentDrop(cb, dragEvent('drop', { dataTransfer: { types: ['Files'], files: [file('same.pdf', 2048)] } }));
    await vi.waitFor(() => {
      expect(cb.dispatchComposer).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'addAttachment', attachment: expect.objectContaining({ id: 'a3' }) }),
      );
    });
  });
});
