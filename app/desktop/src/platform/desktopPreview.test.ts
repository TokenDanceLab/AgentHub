// Desktop PreviewPort content-URL resolution (#1817): absolute evidence URLs
// pass through; host-relative API paths resolve against the Local Edge base
// URL because Desktop owns the Edge connection.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/hubClient', () => ({
  getCachedRefreshedAccessToken: vi.fn(() => null),
}));

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: vi.fn(() => 'desktop-token'),
}));

import type { AttachmentRef } from '@shared/composer';
import {
  resolveDesktopAttachmentImageUrl,
  resolveDesktopEvidenceContentUrl,
  resolveDesktopRuntimeEvidenceContent,
} from './desktopPreview';

describe('resolveDesktopEvidenceContentUrl', () => {
  it('returns absolute evidence URLs unchanged', () => {
    expect(resolveDesktopEvidenceContentUrl('http://127.0.0.1:4173/preview')).toBe(
      'http://127.0.0.1:4173/preview',
    );
    expect(resolveDesktopEvidenceContentUrl('https://preview.example.com/app')).toBe(
      'https://preview.example.com/app',
    );
  });

  it('resolves Edge-relative content paths against the Local Edge base URL', () => {
    // Default test-env Edge base URL (no override configured).
    expect(resolveDesktopEvidenceContentUrl('/v1/runs/run-1/artifacts/artifact-1/content')).toBe(
      'http://127.0.0.1:3210/v1/runs/run-1/artifacts/artifact-1/content',
    );
    expect(resolveDesktopEvidenceContentUrl('/v1/runs/run-1/previews/preview-1/content')).toBe(
      'http://127.0.0.1:3210/v1/runs/run-1/previews/preview-1/content',
    );
  });

  it('yields undefined for empty or non-URL references', () => {
    expect(resolveDesktopEvidenceContentUrl('')).toBeUndefined();
    expect(resolveDesktopEvidenceContentUrl('   ')).toBeUndefined();
    expect(resolveDesktopEvidenceContentUrl('# reports/runtime.patch')).toBeUndefined();
    expect(resolveDesktopEvidenceContentUrl('data:text/plain;base64,abc')).toBeUndefined();
  });
});

describe('resolveDesktopRuntimeEvidenceContent', () => {
  it('maps artifact refs onto the Edge artifact content endpoint', () => {
    expect(
      resolveDesktopRuntimeEvidenceContent({
        kind: 'artifact',
        runId: 'run-1',
        id: 'artifact-1',
      }),
    ).toBe('http://127.0.0.1:3210/v1/runs/run-1/artifacts/artifact-1/content');
  });

  it('maps preview refs onto the Edge preview content endpoint', () => {
    expect(
      resolveDesktopRuntimeEvidenceContent({
        kind: 'preview',
        runId: 'run-2',
        id: 'preview-2',
      }),
    ).toBe('http://127.0.0.1:3210/v1/runs/run-2/previews/preview-2/content');
  });
});

// ── #1938: attachment image resolution ─────────────────────────────────
// Desktop chat attachments live on the Hub, so the resolver fetches the Hub
// attachment endpoint with the desktop access token — parity with Web, no
// Local Edge involvement.

const fetchImpl = vi.fn();
const createObjectURL = vi.fn(() => 'blob:desktop-object-url');
const revokeObjectURL = vi.fn();

function imageResponse(status = 200, type = 'image/png'): Response {
  // Hub serves attachments with an explicit Content-Type header. The blob
  // type derives from that header, which the resolver image guard uses.
  return new Response(new Blob(['img'], { type }), {
    status,
    headers: { 'Content-Type': type },
  });
}

function makeRef(id = 'att-desktop-1'): AttachmentRef {
  return { id, name: 'shot.png', size: 10, mime_type: 'image/png' };
}

beforeAll(() => {
  // Must be stubbed before the lazy resolver captures globalThis.fetch.
  vi.stubGlobal('fetch', fetchImpl);
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('resolveDesktopAttachmentImageUrl (#1938)', () => {
  it('fetches the Hub attachment endpoint with the Bearer token and returns an object URL', async () => {
    fetchImpl.mockReset();
    fetchImpl.mockResolvedValue(imageResponse());

    await expect(resolveDesktopAttachmentImageUrl(makeRef())).resolves.toBe(
      'blob:desktop-object-url',
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toMatch(/\/client\/attachments\/att-desktop-1$/);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer desktop-token');
  });

  it('degrades to undefined on 401 (desktop exposes no refresh hook to the resolver)', async () => {
    fetchImpl.mockReset();
    fetchImpl.mockResolvedValue(imageResponse(401));

    await expect(
      resolveDesktopAttachmentImageUrl(makeRef('att-desktop-401')),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('degrades to undefined when the bytes are not an image', async () => {
    fetchImpl.mockReset();
    fetchImpl.mockResolvedValue(imageResponse(200, 'application/pdf'));

    await expect(
      resolveDesktopAttachmentImageUrl(makeRef('att-desktop-pdf')),
    ).resolves.toBeUndefined();
  });
});
