import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   Mock jszip
   ─────────
   SlideshowPreview lazily does `const mod = await import('jszip')` and then
   reads `mod.default.loadAsync(...)`. We replace the jszip module with a
   default whose `loadAsync` resolves to a fake zip instance.

   The fake `forEach` enumerates two slide entries; `file()` returns an
   object whose `async('string')` yields the slide XML for those entries and
   `null` for any other path (so the rels/image-extraction branch is
   skipped — the component only enters it when `zip.file(relsPath)` is
   truthy).

   Slide text runs are intentionally longer than 20 characters. The
   component truncates the first run to 20 chars for the thumbnail label,
   so the truncated label ("First Slide Heading Te") differs from the full
   text rendered in the slide `<p>` ("First Slide Heading Text"). This
   keeps `findByText` unambiguous — without it, the slide `<p>` and the
   thumbnail button would both contain the identical string and
   `findByText` would throw on a multiple-match.
   ═══════════════════════════════════════════════════════════════════════ */

const mockSlideContents: Record<string, string> = {
  'ppt/slides/slide1.xml':
    '<a:t>First Slide Heading Text</a:t><a:t>First body content</a:t>',
  'ppt/slides/slide2.xml': '<a:t>Second Slide Heading Text</a:t>',
};

interface MockZipFile {
  async(type: string): Promise<string | Blob>;
}

interface MockZipInstance {
  forEach(
    callback: (
      relativePath: string,
      file: { dir: boolean; name: string },
    ) => void,
  ): void;
  file(path: string): MockZipFile | null;
}

function buildMockZipInstance(): MockZipInstance {
  return {
    forEach(callback) {
      const entries = [
        {
          relativePath: 'ppt/slides/slide1.xml',
          file: { dir: false, name: 'slide1.xml' },
        },
        {
          relativePath: 'ppt/slides/slide2.xml',
          file: { dir: false, name: 'slide2.xml' },
        },
      ];
      for (const entry of entries) {
        callback(entry.relativePath, entry.file);
      }
    },
    file(path: string) {
      const content = mockSlideContents[path];
      if (content === undefined) return null;
      return {
        async(type: string): Promise<string | Blob> {
          if (type === 'string') return content;
          if (type === 'blob') return new Blob([content], { type: 'text/xml' });
          throw new Error(`unexpected async type: ${type}`);
        },
      };
    },
  };
}

const loadAsyncMock = vi.fn(async () => buildMockZipInstance());

vi.mock('jszip', () => ({
  default: {
    loadAsync: loadAsyncMock,
  },
}));

import { SlideshowPreview } from './SlideshowPreview';

/** Minimal Blob stub — SlideshowPreview only calls `.arrayBuffer()` on it. */
function makeBlob(): Blob {
  const blob = { arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob;
  return blob;
}

function renderSlideshow(options: { onClose?: () => void } = {}) {
  return render(
    <SlideshowPreview
      fileUrl="https://example.com/presentation.pptx"
      fileName="presentation.pptx"
      fileBlob={makeBlob()}
      onClose={options.onClose}
    />,
  );
}

describe('SlideshowPreview', () => {
  it('renders loading state initially', () => {
    // Keep loadAsync pending so the component stays in the loading branch.
    loadAsyncMock.mockImplementationOnce(() => new Promise<never>(() => {}));
    const { getByText } = renderSlideshow();
    expect(getByText('正在解析演示文稿...')).toBeInTheDocument();
  });

  it('renders slides after loading', async () => {
    const { findByText, getByText } = renderSlideshow();
    // First slide's heading <p> renders once the parse completes.
    expect(await findByText('First Slide Heading Text')).toBeInTheDocument();
    // Second text run on slide 1.
    expect(getByText('First body content')).toBeInTheDocument();
    // Counter shows current position / total.
    expect(getByText('1 / 2')).toBeInTheDocument();
  });

  it('shows close button with key-echo aria-label', async () => {
    const onClose = vi.fn();
    const { findByRole } = renderSlideshow({ onClose });
    // The shared test i18n instance runs in key-echo mode, so
    // t('aria.closePreview') returns 'aria.closePreview'.
    const closeButton = await findByRole('button', { name: 'aria.closePreview' });
    expect(closeButton).toBeInTheDocument();
  });

  it('shows prev/next buttons with key-echo aria-labels', async () => {
    const { findByRole } = renderSlideshow();
    const prevButton = await findByRole('button', { name: 'aria.previousImage' });
    const nextButton = await findByRole('button', { name: 'aria.nextImage' });
    expect(prevButton).toBeInTheDocument();
    expect(nextButton).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const { findByRole } = renderSlideshow({ onClose });
    const closeButton = await findByRole('button', { name: 'aria.closePreview' });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('advances to slide 2 when next button is clicked', async () => {
    const { findByRole, findByText, getByText } = renderSlideshow();
    // Wait for slide 1 to be rendered before interacting.
    await findByText('First Slide Heading Text');
    const nextButton = await findByRole('button', { name: 'aria.nextImage' });
    fireEvent.click(nextButton);
    // Slide 2 heading now renders in the slide canvas.
    expect(await findByText('Second Slide Heading Text')).toBeInTheDocument();
    expect(getByText('2 / 2')).toBeInTheDocument();
  });

  it('disables prev button on the first slide', async () => {
    const { findByRole } = renderSlideshow();
    const prevButton = await findByRole('button', { name: 'aria.previousImage' });
    expect(prevButton).toBeDisabled();
  });

  it('shows error state when parsing fails', async () => {
    loadAsyncMock.mockRejectedValueOnce(new Error('parse failed'));
    const { findByText, getByRole } = renderSlideshow();
    // The component surfaces err.message into the error block.
    expect(await findByText('parse failed')).toBeInTheDocument();
    // Retry button is rendered with its visible text label.
    expect(getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});
