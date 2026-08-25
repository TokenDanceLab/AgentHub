import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';

// Assertions use the en chatview literals (same convention as ImageAttachment.test.tsx).
import { useTestI18nLanguage } from '../../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

import { MediaAttachmentRow } from './MediaAttachment';
import type { RowItem } from '../types';
import {
  registerAttachmentMediaUrlResolver,
  getAttachmentMediaUrlResolver,
} from '../../platform/attachmentMediaPort';
import { MAX_PREVIEW_AUDIO_BYTES, MAX_PREVIEW_VIDEO_BYTES } from '../../ui/mediaPreview';
import type { AttachmentRef } from '../../composer/types';

const audioRef: AttachmentRef = {
  id: 'att-31',
  name: 'voice-note.mp3',
  size: 2048,
  mime_type: 'audio/mpeg',
};

const videoRef: AttachmentRef = {
  id: 'att-32',
  name: 'demo-clip.mp4',
  size: 4096,
  mime_type: 'video/mp4',
};

function mediaItem(
  kind: 'audio' | 'video',
  overrides: Partial<RowItem> = {},
): RowItem {
  const ref = kind === 'audio' ? audioRef : videoRef;
  return {
    id: 'blk-1',
    type: 'attachment',
    label: ref.name,
    status: 'ok',
    collapsible: false,
    standalone: true,
    fileName: ref.name,
    fileSize: '4 KB',
    attachmentKind: kind,
    attachmentRef: ref,
    ...overrides,
  };
}

let unregister: (() => void) | undefined;

afterEach(() => {
  unregister?.();
  unregister = undefined;
});

describe('MediaAttachmentRow (#1939)', () => {
  it('renders a native audio player with controls and an accessible name once the port resolves', async () => {
    unregister = registerAttachmentMediaUrlResolver(async () => 'blob:audio-resolved');

    render(<MediaAttachmentRow item={mediaItem('audio')} />);

    const audio = await screen.findByLabelText('Audio voice-note.mp3');
    expect(audio.tagName).toBe('AUDIO');
    expect(audio).toHaveAttribute('controls');
    expect(audio).toHaveAttribute('src', 'blob:audio-resolved');
    expect(screen.getByText('voice-note.mp3')).toBeInTheDocument();
    expect(screen.getByText('4 KB')).toBeInTheDocument();
  });

  it('renders a native video player with controls and an accessible name once the port resolves', async () => {
    unregister = registerAttachmentMediaUrlResolver(async () => 'blob:video-resolved');

    render(<MediaAttachmentRow item={mediaItem('video')} />);

    const video = await screen.findByLabelText('Video demo-clip.mp4');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('src', 'blob:video-resolved');
    expect(screen.getByText('demo-clip.mp4')).toBeInTheDocument();
  });

  it('shows an explicit loading notice while the port resolves', async () => {
    let release: (url: string | undefined) => void = () => undefined;
    unregister = registerAttachmentMediaUrlResolver(
      () =>
        new Promise<string | undefined>((resolve) => {
          release = resolve;
        }),
    );

    render(<MediaAttachmentRow item={mediaItem('audio')} />);

    expect(screen.getByText('Loading audio…')).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();

    // Release the pending promise so the effect settles inside act().
    await act(async () => {
      release(undefined);
    });
  });

  it('degrades to the chip with a notice when the port cannot resolve', async () => {
    unregister = registerAttachmentMediaUrlResolver(async () => undefined);

    render(<MediaAttachmentRow item={mediaItem('audio')} />);

    expect(await screen.findByText('Audio preview unavailable')).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();

    const { unmount } = render(<MediaAttachmentRow item={mediaItem('video')} />);
    expect(await screen.findByText('Video preview unavailable')).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
    unmount();
  });

  it('degrades to the chip with a notice when no surface registered a resolver', async () => {
    expect(getAttachmentMediaUrlResolver()).toBeUndefined();

    render(<MediaAttachmentRow item={mediaItem('video')} />);

    expect(await screen.findByText('Video preview unavailable')).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
  });

  it('shows an honest too-large notice above the size threshold instead of fetching', async () => {
    let fetched = false;
    unregister = registerAttachmentMediaUrlResolver(async () => {
      fetched = true;
      return 'blob:should-not-be-used';
    });

    render(
      <MediaAttachmentRow
        item={mediaItem('audio', {
          attachmentRef: { ...audioRef, size: MAX_PREVIEW_AUDIO_BYTES + 1 },
        })}
      />,
    );

    expect(
      await screen.findByText('File exceeds the inline preview size limit (64 MB); download it to play locally.'),
    ).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
    expect(fetched).toBe(false);
  });

  it('uses the video threshold for video rows', async () => {
    unregister = registerAttachmentMediaUrlResolver(async () => 'blob:x');

    render(
      <MediaAttachmentRow
        item={mediaItem('video', {
          attachmentRef: { ...videoRef, size: MAX_PREVIEW_VIDEO_BYTES + 1 },
        })}
      />,
    );

    expect(
      await screen.findByText('File exceeds the inline preview size limit (256 MB); download it to play locally.'),
    ).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
  });

  it('does not gate a zero/unknown size (nothing honest to compare against)', async () => {
    unregister = registerAttachmentMediaUrlResolver(async () => 'blob:audio-resolved');

    render(
      <MediaAttachmentRow
        item={mediaItem('audio', {
          fileSize: undefined,
          attachmentRef: { ...audioRef, size: 0 },
        })}
      />,
    );

    const audio = await screen.findByLabelText('Audio voice-note.mp3');
    expect(audio).toHaveAttribute('src', 'blob:audio-resolved');
  });

  it('degrades to a failed notice when the resolved media stops loading', async () => {
    unregister = registerAttachmentMediaUrlResolver(async () => 'blob:audio-resolved');

    render(<MediaAttachmentRow item={mediaItem('audio')} />);

    const audio = await screen.findByLabelText('Audio voice-note.mp3');
    fireEvent.error(audio);

    expect(await screen.findByText('Audio failed to load')).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('never puts a dangerous-scheme URL from a resolver into the player src (#1939 negative)', async () => {
    unregister = registerAttachmentMediaUrlResolver(async () => 'javascript:play()');

    render(<MediaAttachmentRow item={mediaItem('audio')} />);

    expect(await screen.findByText('Audio preview unavailable')).toBeInTheDocument();
    const audio = document.querySelector('audio');
    expect(audio).toBeNull();
  });

  it('never puts a data: URL from a resolver into the video src (#1939 negative)', async () => {
    unregister = registerAttachmentMediaUrlResolver(async () => 'data:video/mp4;base64,AAA');

    render(<MediaAttachmentRow item={mediaItem('video')} />);

    expect(await screen.findByText('Video preview unavailable')).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
  });
});
