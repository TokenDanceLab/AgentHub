import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';

// Assertions use the en chatview literals (same convention as RowItem.test.tsx).
import { useTestI18nLanguage } from '../../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

import { ImageAttachmentRow } from './ImageAttachment';
import type { RowItem } from '../types';
import {
  registerAttachmentImageUrlResolver,
  getAttachmentImageUrlResolver,
} from '../../platform/attachmentImagePort';
import type { AttachmentRef } from '../../composer/types';

const attachmentRef: AttachmentRef = {
  id: 'att-9',
  name: 'screenshot.png',
  size: 2048,
  mime_type: 'image/png',
};

function imageItem(overrides: Partial<RowItem> = {}): RowItem {
  return {
    id: 'blk-1',
    type: 'attachment',
    label: 'screenshot.png',
    status: 'ok',
    collapsible: false,
    standalone: true,
    fileName: 'screenshot.png',
    fileSize: '2 KB',
    attachmentKind: 'image',
    attachmentRef,
    ...overrides,
  };
}

let unregister: (() => void) | undefined;

afterEach(() => {
  unregister?.();
  unregister = undefined;
});

describe('ImageAttachmentRow (#1938)', () => {
  it('renders a thumbnail with alt and a name/size subtitle once the port resolves', async () => {
    unregister = registerAttachmentImageUrlResolver(async () => 'blob:resolved');

    render(<ImageAttachmentRow item={imageItem()} />);

    const img = await screen.findByAltText('screenshot.png');
    expect(img).toHaveAttribute('src', 'blob:resolved');
    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('exposes the thumbnail as a focusable button with an enlarge aria-label', async () => {
    unregister = registerAttachmentImageUrlResolver(async () => 'blob:resolved');

    render(<ImageAttachmentRow item={imageItem()} />);

    const button = await screen.findByRole('button', {
      name: 'View image screenshot.png larger',
    });
    expect(button.tagName).toBe('BUTTON');
    expect(button).not.toHaveAttribute('disabled');
  });

  it('opens the lightbox on click and closes it on Escape', async () => {
    unregister = registerAttachmentImageUrlResolver(async () => 'blob:resolved');

    render(<ImageAttachmentRow item={imageItem()} />);

    const button = await screen.findByRole('button', {
      name: 'View image screenshot.png larger',
    });
    fireEvent.click(button);

    const dialog = await screen.findByRole('dialog');
    const lightboxImg = dialog.querySelector('img');
    expect(lightboxImg).not.toBeNull();
    expect(lightboxImg).toHaveAttribute('src', 'blob:resolved');
    expect(lightboxImg).toHaveAttribute('alt', 'screenshot.png');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens the lightbox from the keyboard (Enter on the focused button)', async () => {
    unregister = registerAttachmentImageUrlResolver(async () => 'blob:resolved');

    render(<ImageAttachmentRow item={imageItem()} />);

    const button = await screen.findByRole('button', {
      name: 'View image screenshot.png larger',
    });
    const user = userEvent.setup();
    button.focus();
    expect(button).toHaveFocus();
    // Native button activation: Enter on the focused button opens the zoom.
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('degrades to the chip with a notice when the port cannot resolve', async () => {
    unregister = registerAttachmentImageUrlResolver(async () => undefined);

    render(<ImageAttachmentRow item={imageItem()} />);

    expect(await screen.findByText('Image preview unavailable')).toBeInTheDocument();
    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('degrades to the chip with a notice when no surface registered a resolver', async () => {
    expect(getAttachmentImageUrlResolver()).toBeUndefined();

    render(<ImageAttachmentRow item={imageItem()} />);

    expect(await screen.findByText('Image preview unavailable')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows an explicit loading notice while the port resolves', async () => {
    let release: (url: string | undefined) => void = () => undefined;
    unregister = registerAttachmentImageUrlResolver(
      () =>
        new Promise<string | undefined>((resolve) => {
          release = resolve;
        }),
    );

    render(<ImageAttachmentRow item={imageItem()} />);

    expect(screen.getByText('Loading image…')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();

    // Release the pending promise so the effect settles inside act().
    await act(async () => {
      release(undefined);
    });
  });

  it('degrades to a failed notice when the resolved image stops loading', async () => {
    unregister = registerAttachmentImageUrlResolver(async () => 'blob:resolved');

    render(<ImageAttachmentRow item={imageItem()} />);

    const img = await screen.findByAltText('screenshot.png');
    fireEvent.error(img);

    expect(await screen.findByText('Image failed to load')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows a failure notice inside the lightbox when the enlarged image errors', async () => {
    unregister = registerAttachmentImageUrlResolver(async () => 'blob:resolved');

    render(<ImageAttachmentRow item={imageItem()} />);

    const button = await screen.findByRole('button', {
      name: 'View image screenshot.png larger',
    });
    fireEvent.click(button);

    const dialog = await screen.findByRole('dialog');
    fireEvent.error(dialog.querySelector('img')!);

    expect(await screen.findByText('Image failed to load')).toBeInTheDocument();
    expect(dialog.querySelector('img')).toBeNull();
  });
});
