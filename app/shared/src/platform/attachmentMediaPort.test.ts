import { describe, expect, it } from 'vitest';

import type { AttachmentRef } from '../composer/types';
import {
  getAttachmentMediaUrlResolver,
  registerAttachmentMediaUrlResolver,
} from './attachmentMediaPort';

const ref: AttachmentRef = { id: 'att-1', name: 'voice.mp3', size: 10, mime_type: 'audio/mpeg' };

describe('attachmentMediaPort registry (#1939)', () => {
  it('starts with no resolver registered', () => {
    expect(getAttachmentMediaUrlResolver()).toBeUndefined();
  });

  it('exposes the registered resolver to the shared transcript with the kind', async () => {
    const unregister = registerAttachmentMediaUrlResolver(async (_attachment, kind) =>
      kind === 'audio' ? 'blob:audio-1' : 'blob:video-1',
    );
    try {
      const active = getAttachmentMediaUrlResolver();
      expect(active).toBeDefined();
      await expect(active!(ref, 'audio')).resolves.toBe('blob:audio-1');
      await expect(active!(ref, 'video')).resolves.toBe('blob:video-1');
    } finally {
      unregister();
    }
  });

  it('lets a later surface registration replace the earlier one', async () => {
    const unregisterWeb = registerAttachmentMediaUrlResolver(async () => 'blob:web');
    const unregisterDesktop = registerAttachmentMediaUrlResolver(async () => 'blob:desktop');
    try {
      await expect(getAttachmentMediaUrlResolver()!(ref, 'audio')).resolves.toBe('blob:desktop');
    } finally {
      unregisterWeb();
      unregisterDesktop();
    }
  });

  it('unregister clears the slot only while the same resolver is active', () => {
    const unregisterFirst = registerAttachmentMediaUrlResolver(async () => 'blob:first');
    const second = async () => 'blob:second';
    const unregisterSecond = registerAttachmentMediaUrlResolver(second);

    // Stale unregister (first) must not clobber the active second resolver.
    unregisterFirst();
    expect(getAttachmentMediaUrlResolver()).toBe(second);

    unregisterSecond();
    expect(getAttachmentMediaUrlResolver()).toBeUndefined();
  });
});
