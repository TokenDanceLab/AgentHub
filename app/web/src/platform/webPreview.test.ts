// Web PreviewPort attachment-image resolution (#1938): the resolver fetches
// the Hub attachment endpoint with the web access token (never a Local Edge
// path), retries once through the single-flight refresh hook on 401, and
// degrades to undefined when the bytes cannot be served.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AttachmentRef } from '@shared/composer';

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: vi.fn(() => 'web-token'),
}));

vi.mock('./webAuthTokenRefresh', () => ({
  getCachedRefreshedAccessToken: vi.fn(() => null),
  refreshWebHubAccessTokenOnce: vi.fn(async () => null),
}));

import { resolveWebAttachmentImageUrl } from './webPreview';
import { getAccessToken } from '@/hooks/useAuth';
import { refreshWebHubAccessTokenOnce } from './webAuthTokenRefresh';

const fetchImpl = vi.fn();
const createObjectURL = vi.fn(() => 'blob:web-object-url');
const revokeObjectURL = vi.fn();

function imageResponse(status = 200, type = 'image/png'): Response {
  // Hub serves attachments with an explicit Content-Type header. The blob
  // type derives from that header, which the resolver image guard uses.
  return new Response(new Blob(['img'], { type }), {
    status,
    headers: { 'Content-Type': type },
  });
}

function makeRef(id = 'att-web-1'): AttachmentRef {
  return { id, name: 'shot.png', size: 10, mime_type: 'image/png' };
}

beforeAll(() => {
  // Must be stubbed before the lazy resolver captures globalThis.fetch.
  vi.stubGlobal('fetch', fetchImpl);
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
});

afterEach(() => {
  fetchImpl.mockReset();
  createObjectURL.mockClear();
  vi.mocked(getAccessToken).mockReturnValue('web-token');
  vi.mocked(refreshWebHubAccessTokenOnce).mockResolvedValue(null);
});

describe('resolveWebAttachmentImageUrl (#1938)', () => {
  it('fetches the Hub attachment endpoint with the Bearer token and returns an object URL', async () => {
    fetchImpl.mockResolvedValue(imageResponse());

    await expect(resolveWebAttachmentImageUrl(makeRef())).resolves.toBe('blob:web-object-url');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    // Web resolves against Hub only: the request URL is the Hub attachment path.
    expect(String(url)).toMatch(/\/client\/attachments\/att-web-1$/);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer web-token');
  });

  it('retries once through the refresh hook after a 401', async () => {
    fetchImpl
      .mockResolvedValueOnce(imageResponse(401))
      .mockResolvedValueOnce(imageResponse());
    vi.mocked(refreshWebHubAccessTokenOnce).mockResolvedValue('web-token-fresh');

    await expect(resolveWebAttachmentImageUrl(makeRef('att-web-401'))).resolves.toBe(
      'blob:web-object-url',
    );

    expect(refreshWebHubAccessTokenOnce).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryHeaders = fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer web-token-fresh');
  });

  it('degrades to undefined when the session cannot be recovered', async () => {
    fetchImpl.mockResolvedValue(imageResponse(401));
    vi.mocked(refreshWebHubAccessTokenOnce).mockResolvedValue(null);

    await expect(resolveWebAttachmentImageUrl(makeRef('att-web-dead'))).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('degrades to undefined on server errors', async () => {
    fetchImpl.mockResolvedValue(imageResponse(500));

    await expect(resolveWebAttachmentImageUrl(makeRef('att-web-500'))).resolves.toBeUndefined();
  });

  it('degrades to undefined when the bytes are not an image', async () => {
    fetchImpl.mockResolvedValue(imageResponse(200, 'application/octet-stream'));

    await expect(resolveWebAttachmentImageUrl(makeRef('att-web-bin'))).resolves.toBeUndefined();
  });
});
