import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComposerAttachment } from '../composer';
import { ComposerAttachmentChip } from './ComposerAttachmentParts';

// These assertions use the en chatview literals; opt into the en bundle of
// the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

const createObjectURL = vi.fn(() => 'blob:mock-preview');
const revokeObjectURL = vi.fn();
vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

afterEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

function renderChip(attachment: ComposerAttachment, uploadProgress?: {
  percent: number;
  phase: 'hashing' | 'uploading' | 'done';
}): ReturnType<typeof render> {
  return render(
    <ComposerAttachmentChip
      attachment={attachment}
      isSubmitting={false}
      onRemove={vi.fn()}
      {...(uploadProgress ? { uploadProgress } : {})}
    />,
  );
}

describe('ComposerAttachmentChip previews', () => {
  it('renders a 30x30 image thumbnail from the attachment file and revokes it on unmount', () => {
    const file = new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' });
    const { container, unmount } = renderChip({
      id: 'att-1',
      name: 'shot.png',
      mime: 'image/png',
      size: 8,
      file,
    });

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('blob:mock-preview');
    expect(img?.style.width).toBe('30px');
    expect(img?.style.height).toBe('30px');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(screen.getByText('shot.png')).toBeInTheDocument();

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview');
  });

  it('falls back to the registry file icon for images without a file', () => {
    const { container } = renderChip({
      id: 'att-1',
      name: 'shot.png',
      mime: 'image/png',
      size: 8,
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-design-file-icon]')).not.toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('shows the file icon for video/audio attachments', () => {
    const { container } = renderChip({
      id: 'att-2',
      name: 'clip.mp4',
      mime: 'video/mp4',
      size: 999,
    });
    expect(container.querySelector('[data-design-file-icon]')).not.toBeNull();
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('renders a 3-line code preview card for text/code attachments', () => {
    renderChip({
      id: 'att-3',
      name: 'main.ts',
      mime: 'text/typescript',
      size: 1024,
      contentPreview: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;',
    });
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
    expect(screen.queryByText('const d = 4;')).toBeNull();
    expect(screen.getByText('+1 more lines')).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps the pill chip while a code attachment is uploading', () => {
    const { container } = renderChip(
      {
        id: 'att-3',
        name: 'main.ts',
        mime: 'text/typescript',
        size: 1024,
        contentPreview: 'const a = 1;\nconst b = 2;',
      },
      { percent: 30, phase: 'uploading' },
    );
    expect(container.querySelector('[data-uploading]')).not.toBeNull();
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.queryByText('const a = 1;')).toBeNull();
  });

  it('renders a plain chip with a remove button for non-previewable files', () => {
    const onRemove = vi.fn();
    render(
      <ComposerAttachmentChip
        attachment={{ id: 'att-4', name: 'archive.zip', size: 1024 }}
        isSubmitting={false}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText('archive.zip')).toBeInTheDocument();
    // The en resource uses a single-brace placeholder ({name}), which real
    // i18next does not interpolate, so the rendered aria-label keeps it.
    fireEvent.click(screen.getByRole('button', { name: 'Remove {name}' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
