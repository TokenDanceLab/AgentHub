// Audio/video routing through FilePreviewRouter (#1939).
//
// Media branches render native <audio controls>/<video controls> with an
// accessible name; every cap/gate (format cap, size cap, missing source,
// dangerous scheme) degrades to an explicit notice — never an empty player
// and never a binary dump in the code viewer.
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { useTestI18nLanguage } from '@shared/testing/i18n';
import type { PreviewPort } from '@shared/platform';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

import { FilePreviewRouter, type PreviewFile } from './FilePreviewRouter';

const MEDIA_NO_URL =
  'No accessible audio/video content address was provided (this client has no content endpoint), so the preview cannot be rendered.';

function mediaFile(overrides: Partial<PreviewFile> = {}): PreviewFile {
  return {
    name: 'voice.mp3',
    type: 'artifact',
    content: 'https://cdn.example.test/media/voice.mp3',
    ...overrides,
  };
}

/** Web-shaped port: absolute http(s) content resolves, host-relative paths do not. */
function webShapedPort(): PreviewPort {
  return {
    openEvidence: vi.fn().mockResolvedValue(undefined),
    resolveContentUrl: (ref: string) => (/^https?:\/\//i.test(ref) ? ref : undefined),
  };
}

describe('FilePreviewRouter audio/video branches (#1939)', () => {
  it('renders an audio file as a native player with controls and an accessible name', () => {
    render(<FilePreviewRouter file={mediaFile()} onClose={vi.fn()} previewPort={webShapedPort()} />);

    const audio = screen.getByLabelText('Audio preview voice.mp3');
    expect(audio.tagName).toBe('AUDIO');
    expect(audio).toHaveAttribute('controls');
    expect(audio).toHaveAttribute('src', 'https://cdn.example.test/media/voice.mp3');
    // Visible filename caption doubles as the accessible caption.
    expect(screen.getByText('voice.mp3')).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
  });

  it('renders a video file as a native player with controls and an accessible name', () => {
    render(
      <FilePreviewRouter
        file={mediaFile({ name: 'demo.mp4', content: 'https://cdn.example.test/media/demo.mp4' })}
        onClose={vi.fn()}
        previewPort={webShapedPort()}
      />,
    );

    const video = screen.getByLabelText('Video preview demo.mp4');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('src', 'https://cdn.example.test/media/demo.mp4');
  });

  it('resolves host-relative content through the platform port (existing port path)', () => {
    const port: PreviewPort = {
      openEvidence: vi.fn().mockResolvedValue(undefined),
      resolveContentUrl: (ref: string) => `https://host.example.test${ref}`,
    };

    render(
      <FilePreviewRouter
        file={mediaFile({ name: 'clip.webm', content: '/media/run-1/clip.webm' })}
        onClose={vi.fn()}
        previewPort={port}
      />,
    );

    const video = screen.getByLabelText('Video preview clip.webm');
    expect(video).toHaveAttribute('src', 'https://host.example.test/media/run-1/clip.webm');
  });

  it('accepts blob: object URLs from the port (attachment-fetch shape)', () => {
    const port: PreviewPort = {
      openEvidence: vi.fn().mockResolvedValue(undefined),
      resolveRuntimeEvidenceContent: () => 'blob:https://app.example.test/1-2-3',
    };

    render(
      <FilePreviewRouter
        file={mediaFile({
          name: 'voice.mp3',
          content: undefined,
          contentRef: { kind: 'artifact', runId: 'run-1', id: 'art-1' },
        })}
        onClose={vi.fn()}
        previewPort={port}
      />,
    );

    const audio = screen.getByLabelText('Audio preview voice.mp3');
    expect(audio).toHaveAttribute('src', 'blob:https://app.example.test/1-2-3');
  });

  it('shows the honest no-content-source notice when nothing resolvable exists', () => {
    // Content is the mapper's fallback prose, not a URL (#1817 honesty contract).
    render(
      <FilePreviewRouter
        file={mediaFile({ content: '# voice.mp3\n\n- Run: run-1' })}
        onClose={vi.fn()}
        previewPort={webShapedPort()}
      />,
    );

    expect(screen.getByText(MEDIA_NO_URL)).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
    expect(document.querySelector('video')).toBeNull();
  });

  it('shows the no-content-source notice when no port can resolve a host-relative path', () => {
    render(
      <FilePreviewRouter
        file={mediaFile({ content: '/media/run-1/voice.mp3' })}
        onClose={vi.fn()}
        previewPort={undefined}
      />,
    );

    expect(screen.getByText(MEDIA_NO_URL)).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('never routes unknown/dangerous schemes into the player src (#1939 negative)', () => {
    const dangerous = [
      'javascript:play()',
      'data:audio/mpeg;base64,AAA',
      'file:///media/voice.mp3',
      'vbscript:msgbox',
    ];
    for (const content of dangerous) {
      const { unmount } = render(
        <FilePreviewRouter file={mediaFile({ content })} onClose={vi.fn()} previewPort={webShapedPort()} />,
      );
      expect(screen.getByText(MEDIA_NO_URL)).toBeInTheDocument();
      expect(document.querySelector('audio')).toBeNull();
      expect(document.querySelector('video')).toBeNull();
      unmount();
    }
  });

  it('rejects userinfo-carrying URLs from the port (#1933 shape)', () => {
    render(
      <FilePreviewRouter
        file={mediaFile({ content: 'https://user:pass@cdn.example.test/voice.mp3' })} // # leak-guard-allow:LG-F4C6A155 (fake fixture)
        onClose={vi.fn()}
        previewPort={webShapedPort()}
      />,
    );

    expect(screen.getByText(MEDIA_NO_URL)).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('rejects dangerous schemes even when a malicious port returns them', () => {
    const maliciousPort: PreviewPort = {
      openEvidence: vi.fn().mockResolvedValue(undefined),
      resolveRuntimeEvidenceContent: () => 'javascript:play()',
    };

    render(
      <FilePreviewRouter
        file={mediaFile({
          content: undefined,
          contentRef: { kind: 'artifact', runId: 'run-1', id: 'art-1' },
        })}
        onClose={vi.fn()}
        previewPort={maliciousPort}
      />,
    );

    expect(screen.getByText(MEDIA_NO_URL)).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('shows the unsupported-format notice for detected-but-unplayable media', () => {
    for (const name of ['song.wma', 'clip.mkv']) {
      const { unmount } = render(
        <FilePreviewRouter
          file={mediaFile({ name, content: `https://cdn.example.test/${name}` })}
          onClose={vi.fn()}
          previewPort={webShapedPort()}
        />,
      );
      expect(
        screen.getByText(
          'This media format is beyond the browser inline-playback format cap and cannot play online; download it to play locally.',
        ),
      ).toBeInTheDocument();
      expect(document.querySelector('audio')).toBeNull();
      expect(document.querySelector('video')).toBeNull();
      unmount();
    }
  });

  it('shows the too-large notice above the documented size thresholds', () => {
    render(
      <FilePreviewRouter
        file={mediaFile({ sizeBytes: 64 * 1024 * 1024 + 1 })}
        onClose={vi.fn()}
        previewPort={webShapedPort()}
      />,
    );

    expect(
      screen.getByText(
        'File exceeds the inline preview size limit (64 MB) and cannot play online; download it to play locally.',
      ),
    ).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('renders the player when the size is unknown (nothing honest to gate on)', () => {
    render(
      <FilePreviewRouter
        file={mediaFile({ name: 'demo.mp4', content: 'https://cdn.example.test/demo.mp4' })}
        onClose={vi.fn()}
        previewPort={webShapedPort()}
      />,
    );

    expect(screen.getByLabelText('Video preview demo.mp4')).toHaveAttribute('controls');
  });

  it('degrades to the load-failed notice when the media element errors', () => {
    render(<FilePreviewRouter file={mediaFile()} onClose={vi.fn()} previewPort={webShapedPort()} />);

    fireEvent.error(screen.getByLabelText('Audio preview voice.mp3'));

    expect(
      screen.getByText(
        'The audio/video content address exists but failed to load (it may have expired or this client lacks access).',
      ),
    ).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('still routes non-media files to the code viewer (no regression)', () => {
    render(
      <FilePreviewRouter
        file={{ name: 'notes.xyz', type: 'file', content: 'plain text body' }}
        onClose={vi.fn()}
        previewPort={webShapedPort()}
      />,
    );

    expect(document.querySelector('audio')).toBeNull();
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText('plain text body')).toBeInTheDocument();
  });
});
