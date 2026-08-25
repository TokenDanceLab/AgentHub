import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AttachmentRef } from '../composer/types';
import { createAttachmentMediaUrlResolver } from './createAttachmentMediaUrlResolver';

const HUB_BASE = 'https://hub.example.test';

function makeRef(id = 'att-1'): AttachmentRef {
  return { id, name: 'voice.mp3', size: 10, mime_type: 'audio/mpeg' };
}

function mediaResponse(status = 200, type = 'audio/mpeg'): Response {
  // Hub serves attachments with an explicit Content-Type header; the blob
  // type derives from it and feeds the per-kind byte gate. String body
  // keeps the fixture portable across jsdom/undici Response implementations.
  return new Response('media-bytes', {
    status,
    headers: { 'Content-Type': type },
  });
}

const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  createObjectURL.mockReset();
  revokeObjectURL.mockReset();
  createObjectURL.mockImplementation(() => 'blob:object-url');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createAttachmentMediaUrlResolver (#1939)', () => {
  it('resolves audio bytes to an object URL for the audio kind', async () => {
    const fetchImpl = vi.fn(async () => mediaResponse());
    const resolver = createAttachmentMediaUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef(), 'audio')).resolves.toBe('blob:object-url');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${HUB_BASE}/client/attachments/att-1`);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('resolves video bytes to an object URL for the video kind', async () => {
    const fetchImpl = vi.fn(async () => mediaResponse(200, 'video/mp4'));
    const resolver = createAttachmentMediaUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef(), 'video')).resolves.toBe('blob:object-url');
  });

  it('degrades to undefined when audio kind receives video bytes', async () => {
    const fetchImpl = vi.fn(async () => mediaResponse(200, 'video/mp4'));
    const resolver = createAttachmentMediaUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef(), 'audio')).resolves.toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('degrades to undefined when video kind receives audio bytes', async () => {
    const fetchImpl = vi.fn(async () => mediaResponse(200, 'audio/mpeg'));
    const resolver = createAttachmentMediaUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef(), 'video')).resolves.toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('accepts bytes without a stored mime (Hub sometimes stores none)', async () => {
    // A bare Blob has an empty type per spec; routing it through `new
    // Response(...)` would stamp a default text/plain Content-Type in both
    // jsdom and undici, which is NOT the no-mime case — so hand the resolver
    // a minimal Response-shaped object whose blob() returns the bare Blob.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['media-bytes']),
    }) as unknown as Response);
    const resolver = createAttachmentMediaUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef(), 'audio')).resolves.toBe('blob:object-url');
  });

  it('retries once with the refreshed token after a 401', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mediaResponse(401))
      .mockResolvedValueOnce(mediaResponse());
    const refreshAccessTokenOnce = vi.fn(async () => 'tok-fresh');
    const resolver = createAttachmentMediaUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-stale',
      refreshAccessTokenOnce,
      fetchImpl,
    });

    await expect(resolver(makeRef(), 'audio')).resolves.toBe('blob:object-url');
    expect(refreshAccessTokenOnce).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('degrades to undefined on non-2xx responses', async () => {
    const fetchImpl = vi.fn(async () => mediaResponse(404));
    const resolver = createAttachmentMediaUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef(), 'audio')).resolves.toBeUndefined();
  });

  it('degrades to undefined for a missing id and never fetches', async () => {
    const fetchImpl = vi.fn(async () => mediaResponse());
    const resolver = createAttachmentMediaUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef('  '), 'audio')).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps separate caches per kind for the same attachment id', async () => {
    // Same id resolved under both kinds: each kind fetches once (its own
    // cache), and the audio-kind byte gate rejects the video response.
    const fetchImpl = vi.fn(async () => mediaResponse(200, 'audio/mpeg'));
    const resolver = createAttachmentMediaUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef(), 'audio')).resolves.toBe('blob:object-url');
    await expect(resolver(makeRef(), 'audio')).resolves.toBe('blob:object-url');
    await expect(resolver(makeRef(), 'video')).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
