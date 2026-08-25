import type { Meta, StoryObj } from '@storybook/react';
import { useEffect } from 'react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import type { AttachmentRef } from '../../composer/types';
import type { AttachmentMediaUrlResolver } from '../../platform/attachmentMediaPort';
import { registerAttachmentMediaUrlResolver } from '../../platform/attachmentMediaPort';
import { MAX_PREVIEW_AUDIO_BYTES } from '../../ui/mediaPreview';
import { CHATVIEW_I18N_NAMESPACE, chatviewResources } from '../i18n/resources';
import type { RowItem } from '../types';
import { MediaAttachmentRow } from './MediaAttachment';

/* Storybook i18n: isolated instance with the chatview bundle so notices and
   accessible names render real copy (same shape as the test i18n factory). */
const storyI18n = i18next.createInstance();
void storyI18n.use(initReactI18next).init({
  resources: {
    zh: { [CHATVIEW_I18N_NAMESPACE]: chatviewResources.zh },
    en: { [CHATVIEW_I18N_NAMESPACE]: chatviewResources.en },
  },
  lng: 'zh',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

/** Build a tiny silent WAV in-memory so ready-state stories have playable bytes. */
function buildSilentWav(): Blob {
  const sampleRate = 8000;
  const frames = 4000; // 0.5s of silence
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, frames * 2, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

let demoAudioUrl: string | undefined;
function getDemoAudioUrl(): string {
  demoAudioUrl ??= URL.createObjectURL(buildSilentWav());
  return demoAudioUrl;
}

const audioRef: AttachmentRef = {
  id: 'story-audio',
  name: 'voice-note.mp3',
  size: 2048,
  mime_type: 'audio/mpeg',
};

const videoRef: AttachmentRef = {
  id: 'story-video',
  name: 'demo-clip.mp4',
  size: 4096,
  mime_type: 'video/mp4',
};

function mediaItem(kind: 'audio' | 'video', overrides: Partial<RowItem> = {}): RowItem {
  const ref = kind === 'audio' ? audioRef : videoRef;
  return {
    id: `story-${kind}`,
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

/** Registers the given resolver for the story's lifetime (none = unavailable state). */
function MediaRowStory({
  item,
  resolve,
}: {
  item: RowItem;
  resolve?: AttachmentMediaUrlResolver;
}) {
  useEffect(() => {
    if (!resolve) return undefined;
    return registerAttachmentMediaUrlResolver(resolve);
  }, [resolve]);
  return <MediaAttachmentRow item={item} />;
}

const meta: Meta<typeof MediaRowStory> = {
  title: 'ChatView/MediaAttachment',
  component: MediaRowStory,
  decorators: [
    (Story) => (
      <I18nextProvider i18n={storyI18n}>
        <div className="chatview" style={{ padding: 16, maxWidth: 420 }}>
          <Story />
        </div>
      </I18nextProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof MediaRowStory>;

/** Resolved audio: native <audio controls> with name/size subtitle. */
export const AudioReady: Story = {
  render: () => (
    <MediaRowStory item={mediaItem('audio')} resolve={async () => getDemoAudioUrl()} />
  ),
};

/** Resolved video: native <video controls> (demo blob has no decodable frames — controls still render). */
export const VideoReady: Story = {
  render: () => (
    <MediaRowStory item={mediaItem('video')} resolve={async () => getDemoAudioUrl()} />
  ),
};

/** Port still resolving: explicit loading notice, no player yet. */
export const Loading: Story = {
  render: () => (
    <MediaRowStory item={mediaItem('audio')} resolve={() => new Promise(() => undefined)} />
  ),
};

/** No surface resolver registered: honest chip fallback. */
export const Unavailable: Story = {
  render: () => <MediaRowStory item={mediaItem('video')} />,
};

/** Known size above the shared threshold: too-large notice, never fetched. */
export const TooLarge: Story = {
  render: () => (
    <MediaRowStory
      item={mediaItem('audio', {
        attachmentRef: { ...audioRef, size: MAX_PREVIEW_AUDIO_BYTES + 1 },
      })}
      resolve={async () => getDemoAudioUrl()}
    />
  ),
};
