import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AttachmentRef } from '../composer/types';
import { createAttachmentImageUrlResolver } from './createAttachmentImageUrlResolver';

const HUB_BASE = 'https://hub.example.test';

function makeRef(id = 'att-1'): AttachmentRef {
  return { id, name: 'shot.png', size: 10, mime_type: 'image/png' };
}

function imageResponse(status = 200, type = 'image/png'): Response {
  // Hub serves attachments with an explicit Content-Type header. The blob
  // type derives from that header, which the resolver image guard uses.
  // String body (not a Blob body) keeps the fixture portable across the
  // jsdom/undici Response implementations used by the different suites.
  return new Response('img-bytes', {
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

describe('createAttachmentImageUrlResolver (#1938)', () => {
  it('fetches the Hub attachment endpoint with the Bearer token and returns an object URL', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef())).resolves.toBe('blob:object-url');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${HUB_BASE}/client/attachments/att-1`);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('encodes attachment ids in the download path', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await resolver(makeRef('a/b c'));

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${HUB_BASE}/client/attachments/a%2Fb%20c`);
  });

  it('retries once with the refreshed token after a 401', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(imageResponse(401))
      .mockResolvedValueOnce(imageResponse());
    const refreshAccessTokenOnce = vi.fn(async () => 'tok-fresh');
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-stale',
      refreshAccessTokenOnce,
      fetchImpl,
    });

    await expect(resolver(makeRef())).resolves.toBe('blob:object-url');

    expect(refreshAccessTokenOnce).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryHeaders = fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer tok-fresh');
  });

  it('degrades to undefined when the refresh cannot recover the session', async () => {
    const fetchImpl = vi.fn(async () => imageResponse(401));
    const refreshAccessTokenOnce = vi.fn(async () => null);
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-stale',
      refreshAccessTokenOnce,
      fetchImpl,
    });

    await expect(resolver(makeRef())).resolves.toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('degrades to undefined without a refresh hook on 401', async () => {
    const fetchImpl = vi.fn(async () => imageResponse(401));
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-stale',
      fetchImpl,
    });

    await expect(resolver(makeRef())).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('degrades to undefined on non-2xx responses', async () => {
    const fetchImpl = vi.fn(async () => imageResponse(404));
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef())).resolves.toBeUndefined();
  });

  it('degrades to undefined when the bytes are not an image', async () => {
    const fetchImpl = vi.fn(async () => imageResponse(200, 'application/pdf'));
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef())).resolves.toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('degrades to undefined for a missing id or empty hub base', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });
    const emptyBaseResolver = createAttachmentImageUrlResolver({
      hubBaseUrl: '   ',
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef('  '))).resolves.toBeUndefined();
    await expect(emptyBaseResolver(makeRef())).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('degrades to undefined on network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await expect(resolver(makeRef())).resolves.toBeUndefined();
  });

  it('omits the Authorization header when signed out', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => null,
      fetchImpl,
    });

    await resolver(makeRef());

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('reuses the cached object URL for repeat resolutions of the same id', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    await resolver(makeRef());
    await expect(resolver(makeRef())).resolves.toBe('blob:object-url');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent resolutions of the same id to one fetch', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
    });

    const [a, b] = await Promise.all([resolver(makeRef()), resolver(makeRef())]);

    expect(a).toBe('blob:object-url');
    expect(b).toBe('blob:object-url');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest cached object URL FIFO once the limit is exceeded', async () => {
    let call = 0;
    createObjectURL.mockImplementation(() => `blob:url-${(call += 1)}`);
    const fetchImpl = vi.fn(async () => imageResponse());
    const resolver = createAttachmentImageUrlResolver({
      hubBaseUrl: HUB_BASE,
      getToken: () => 'tok-1',
      fetchImpl,
      cacheLimit: 2,
    });

    await resolver(makeRef('att-1'));
    await resolver(makeRef('att-2'));
    await resolver(makeRef('att-3'));

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-1');

    // att-2 and att-3 stay cached; att-1 must refetch after eviction.
    await resolver(makeRef('att-2'));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
