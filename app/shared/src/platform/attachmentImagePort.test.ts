import { describe, expect, it } from 'vitest';

import type { AttachmentRef } from '../composer/types';
import {
  getAttachmentImageUrlResolver,
  registerAttachmentImageUrlResolver,
} from './attachmentImagePort';

const ref: AttachmentRef = { id: 'att-1', name: 'shot.png', size: 10, mime_type: 'image/png' };

describe('attachmentImagePort registry (#1938)', () => {
  it('starts with no resolver registered', () => {
    expect(getAttachmentImageUrlResolver()).toBeUndefined();
  });

  it('exposes the registered resolver to the shared transcript', async () => {
    const unregister = registerAttachmentImageUrlResolver(async () => 'blob:web-1');
    try {
      const active = getAttachmentImageUrlResolver();
      expect(active).toBeDefined();
      await expect(active!(ref)).resolves.toBe('blob:web-1');
    } finally {
      unregister();
    }
  });

  it('lets a later surface registration replace the earlier one', async () => {
    const unregisterWeb = registerAttachmentImageUrlResolver(async () => 'blob:web');
    const unregisterDesktop = registerAttachmentImageUrlResolver(async () => 'blob:desktop');
    try {
      await expect(getAttachmentImageUrlResolver()!(ref)).resolves.toBe('blob:desktop');
    } finally {
      unregisterWeb();
      unregisterDesktop();
    }
  });

  it('unregister clears the slot only while the same resolver is active', () => {
    const unregisterFirst = registerAttachmentImageUrlResolver(async () => 'blob:first');
    const second = async () => 'blob:second';
    const unregisterSecond = registerAttachmentImageUrlResolver(second);

    // Stale unregister (first) must not clobber the active second resolver.
    unregisterFirst();
    expect(getAttachmentImageUrlResolver()).toBe(second);

    unregisterSecond();
    expect(getAttachmentImageUrlResolver()).toBeUndefined();
  });
});
