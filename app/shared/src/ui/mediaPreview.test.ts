import { describe, expect, it } from 'vitest';

import {
  MAX_PREVIEW_AUDIO_BYTES,
  MAX_PREVIEW_VIDEO_BYTES,
  formatPreviewByteLimit,
  isAudioFileName,
  isNativelyPlayableMediaFileName,
  isSafeMediaSourceUrl,
  isVideoFileName,
  isWithinPreviewSizeLimit,
  maxPreviewBytesForKind,
  mediaKindForFileName,
} from './mediaPreview';

describe('mediaPreview detection (#1939)', () => {
  it('detects audio extensions case-insensitively', () => {
    for (const name of ['voice.mp3', 'voice.WAV', 'track.ogg', 'a.oga', 'b.m4a', 'c.aac', 'd.flac', 'e.opus']) {
      expect(isAudioFileName(name), name).toBe(true);
      expect(mediaKindForFileName(name), name).toBe('audio');
    }
  });

  it('detects video extensions case-insensitively', () => {
    for (const name of ['clip.mp4', 'clip.M4V', 'clip.webm', 'clip.ogv', 'clip.mov', 'clip.mkv', 'clip.avi']) {
      expect(isVideoFileName(name), name).toBe(true);
      expect(mediaKindForFileName(name), name).toBe('video');
    }
  });

  it('rejects non-media names and bare extensions', () => {
    for (const name of ['app.ts', 'notes.txt', 'mp3', 'mp3.txt', '', 'video.mp4.bak']) {
      expect(mediaKindForFileName(name), name).toBeUndefined();
    }
  });
});

describe('mediaPreview format cap (#1939)', () => {
  it('accepts browser-natively playable containers', () => {
    for (const name of ['a.mp3', 'a.wav', 'a.ogg', 'a.m4a', 'a.flac', 'v.mp4', 'v.webm', 'v.ogv', 'v.mov']) {
      expect(isNativelyPlayableMediaFileName(name), name).toBe(true);
    }
  });

  it('rejects detected-but-unplayable formats so the UI can notice honestly', () => {
    for (const name of ['a.wma', 'a.mid', 'v.mkv', 'v.avi', 'v.wmv', 'v.flv', 'x.txt']) {
      expect(isNativelyPlayableMediaFileName(name), name).toBe(false);
    }
  });
});

describe('mediaPreview size thresholds (#1939)', () => {
  it('defines the documented thresholds', () => {
    expect(MAX_PREVIEW_AUDIO_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_PREVIEW_VIDEO_BYTES).toBe(256 * 1024 * 1024);
    expect(maxPreviewBytesForKind('audio')).toBe(MAX_PREVIEW_AUDIO_BYTES);
    expect(maxPreviewBytesForKind('video')).toBe(MAX_PREVIEW_VIDEO_BYTES);
  });

  it('passes sizes at/under the cap and fails sizes above it', () => {
    expect(isWithinPreviewSizeLimit('audio', MAX_PREVIEW_AUDIO_BYTES)).toBe(true);
    expect(isWithinPreviewSizeLimit('audio', MAX_PREVIEW_AUDIO_BYTES + 1)).toBe(false);
    expect(isWithinPreviewSizeLimit('video', MAX_PREVIEW_VIDEO_BYTES)).toBe(true);
    expect(isWithinPreviewSizeLimit('video', MAX_PREVIEW_VIDEO_BYTES + 1)).toBe(false);
  });

  it('does not gate unknown sizes (nothing honest to compare against)', () => {
    expect(isWithinPreviewSizeLimit('audio', undefined)).toBe(true);
    expect(isWithinPreviewSizeLimit('video', undefined)).toBe(true);
  });

  it('formats limits as whole megabytes for notices', () => {
    expect(formatPreviewByteLimit(MAX_PREVIEW_AUDIO_BYTES)).toBe('64 MB');
    expect(formatPreviewByteLimit(MAX_PREVIEW_VIDEO_BYTES)).toBe('256 MB');
  });
});

describe('isSafeMediaSourceUrl — negative scheme gate (#1939)', () => {
  it('accepts absolute http(s) and blob: object URLs', () => {
    expect(isSafeMediaSourceUrl('https://cdn.example.test/a.mp3')).toBe(true);
    expect(isSafeMediaSourceUrl('http://cdn.example.test/a.mp3')).toBe(true);
    expect(isSafeMediaSourceUrl('blob:https://app.example.test/1-2-3')).toBe(true);
  });

  it('rejects unknown/dangerous schemes before they reach a player src', () => {
    for (const url of [
      'javascript:play()',
      'data:audio/mpeg;base64,AAA',
      'file:///media/clip.mp4',
      'vbscript:msgbox',
      'ws://stream.example.test/live',
      'ftp://media.example.test/a.mp3',
    ]) {
      expect(isSafeMediaSourceUrl(url), url).toBe(false);
    }
  });

  it('rejects protocol-relative, relative and empty values', () => {
    for (const url of ['//cdn.example.test/a.mp3', '/v1/media/a.mp3', 'a.mp3', '', '   ']) {
      expect(isSafeMediaSourceUrl(url), url).toBe(false);
    }
  });

  it('rejects userinfo-carrying http(s) URLs (#1933 shape)', () => {
    expect(isSafeMediaSourceUrl('https://user:pass@cdn.example.test/a.mp3')).toBe(false); // # leak-guard-allow:LG-F4C6A155 (fake fixture)
    expect(isSafeMediaSourceUrl('http://token@cdn.example.test/a.mp3')).toBe(false);
  });
});
