// real_tested=true — hashing runs through the real computeFileHash (Node webcrypto SHA-256);
// only the transport layer (XMLHttpRequest / fetch) is replaced with in-memory fakes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  uploadAttachmentWithProgress,
  uploadPendingAttachmentsWithProgress,
} from './upload';
import type { AttachmentUploadContext, AttachmentUploadProgress } from './upload';
import type { AttachmentRef, ComposerAttachment } from './types';

const HUB_BASE_URL = 'http://hub.test:8080';
const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA256_HELLO = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

interface FakeUploadProgressEvent {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

/**
 * Minimal in-memory XMLHttpRequest stand-in. `upload.ts` only touches
 * open/setRequestHeader/send, the `upload.onprogress` hook, and the
 * onload/onerror callbacks, so the fake needs nothing else.
 */
class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];

  status = 0;
  responseText = '';
  method = '';
  url = '';
  requestHeaders: Record<string, string> = {};
  sentBody: FormData | null = null;
  upload: { onprogress: ((event: FakeUploadProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    FakeXMLHttpRequest.instances.push(this);
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name] = value;
  }

  send(body: FormData): void {
    this.sentBody = body;
  }

  respondWith(status: number, responseText: string): void {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }

  failNetwork(): void {
    this.onerror?.();
  }

  emitUploadProgress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.onprogress?.({ lengthComputable, loaded, total });
  }
}

function makeContext(overrides: Partial<AttachmentUploadContext> = {}): AttachmentUploadContext {
  return {
    hubBaseUrl: HUB_BASE_URL,
    getToken: () => null,
    ...overrides,
  };
}

function makeFile(contents = 'hello', name = 'hello.txt'): File {
  return new File([contents], name, { type: 'text/plain' });
}

function latestXhr(): FakeXMLHttpRequest {
  const xhr = FakeXMLHttpRequest.instances[FakeXMLHttpRequest.instances.length - 1];
  if (!xhr) throw new Error('Expected an XMLHttpRequest to have been created');
  return xhr;
}

async function waitForXhr(): Promise<FakeXMLHttpRequest> {
  await vi.waitFor(() => {
    expect(FakeXMLHttpRequest.instances.length).toBeGreaterThan(0);
  });
  return latestXhr();
}

function requireBody(xhr: FakeXMLHttpRequest): FormData {
  if (!xhr.sentBody) throw new Error('Expected xhr.send() to be called with a FormData body');
  return xhr.sentBody;
}

function hubEnvelope(data: unknown): string {
  return JSON.stringify({ code: 'ok', data });
}

const STORED_ATTACHMENT: AttachmentRef = {
  id: 'att-1',
  name: 'stored.txt',
  original_name: 'renamed.txt',
  size: 1234,
  mime_type: 'text/plain',
  hash: 'server-hash',
  metadata: '{"k":"v"}',
  created_at: '2026-08-19T00:00:00Z',
};

beforeEach(() => {
  FakeXMLHttpRequest.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
  // setup.ts installs a shared `fetch = vi.fn()`; clear any state between tests.
  vi.mocked(fetch).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadAttachmentWithProgress', () => {
  it('hashes with the real SHA-256 and POSTs the multipart fields', async () => {
    const file = makeFile('hello', 'hello.txt');
    const pending = uploadAttachmentWithProgress(file, makeContext());

    const xhr = await waitForXhr();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(`${HUB_BASE_URL}/client/attachments`);
    expect(xhr.requestHeaders['Authorization']).toBeUndefined();

    const body = requireBody(xhr);
    expect(body.get('hash')).toBe(SHA256_HELLO);
    expect(body.get('original_name')).toBe('hello.txt');
    expect(body.get('file')).toBe(file);

    xhr.respondWith(201, hubEnvelope(STORED_ATTACHMENT));
    const result = await pending;

    expect(result.downloadUrl).toBe(`${HUB_BASE_URL}/client/attachments/att-1`);
    expect(result.attachmentRef).toEqual(expect.objectContaining({
      id: 'att-1',
      name: 'renamed.txt',
      original_name: 'renamed.txt',
      size: 1234,
      mime_type: 'text/plain',
      hash: 'server-hash',
      url: result.downloadUrl,
      metadata: '{"k":"v"}',
      created_at: '2026-08-19T00:00:00Z',
    }));
  });

  it('adds an Authorization header only when a token is provided', async () => {
    const pending = uploadAttachmentWithProgress(
      makeFile(),
      makeContext({ getToken: () => 'jwt-123' }),
    );
    const xhr = await waitForXhr();
    expect(xhr.requestHeaders['Authorization']).toBe('Bearer jwt-123');

    xhr.respondWith(200, hubEnvelope(STORED_ATTACHMENT));
    await expect(pending).resolves.toBeTruthy();
  });

  it('reports hashing and upload progress mapped onto the 15-95% band', async () => {
    const progress: AttachmentUploadProgress[] = [];
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext(), (p) => progress.push(p));

    const xhr = await waitForXhr();
    xhr.emitUploadProgress(0, 100);
    xhr.emitUploadProgress(25, 100);
    xhr.emitUploadProgress(100, 100);
    xhr.respondWith(200, hubEnvelope(STORED_ATTACHMENT));
    await pending;

    expect(progress).toEqual([
      { percent: 0, phase: 'hashing' },
      { percent: 10, phase: 'hashing' },
      { percent: 15, phase: 'uploading' },
      { percent: 35, phase: 'uploading' },
      { percent: 95, phase: 'uploading' },
      { percent: 100, phase: 'done' },
    ]);
  });

  it('ignores upload progress events that are not length-computable', async () => {
    const progress: AttachmentUploadProgress[] = [];
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext(), (p) => progress.push(p));

    const xhr = await waitForXhr();
    xhr.emitUploadProgress(50, 100, false);
    xhr.respondWith(200, hubEnvelope(STORED_ATTACHMENT));
    await pending;

    expect(progress).toEqual([
      { percent: 0, phase: 'hashing' },
      { percent: 10, phase: 'hashing' },
      { percent: 100, phase: 'done' },
    ]);
  });

  it('parses a direct response without the Hub envelope', async () => {
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext());
    const xhr = await waitForXhr();
    xhr.respondWith(
      200,
      JSON.stringify({ id: 'att-2', size: 7, mime_type: 'application/octet-stream' }),
    );
    const result = await pending;

    expect(result.attachmentRef).toEqual({
      id: 'att-2',
      name: 'hello.txt',
      size: 7,
      mime_type: 'application/octet-stream',
      hash: SHA256_HELLO,
      url: `${HUB_BASE_URL}/client/attachments/att-2`,
    });
  });

  it('rejects with the HTTP status on non-2xx responses', async () => {
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext());
    const xhr = await waitForXhr();
    xhr.respondWith(404, 'not found');
    await expect(pending).rejects.toThrow('Upload failed: HTTP 404');
  });

  it('rejects on transport errors', async () => {
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext());
    const xhr = await waitForXhr();
    xhr.failNetwork();
    await expect(pending).rejects.toThrow('Upload failed: network error');
  });

  it('wraps JSON parse failures with a descriptive message', async () => {
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext());
    const xhr = await waitForXhr();
    xhr.respondWith(200, 'not json{');
    await expect(pending).rejects.toThrow(/Failed to parse upload response/);
  });

  it('percent-encodes special characters in the attachment id in the download URL', async () => {
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext());
    const xhr = await waitForXhr();
    xhr.respondWith(200, hubEnvelope({ id: 'att/odd id?', name: 'x', size: 1, mime_type: 'x/y' }));
    const result = await pending;

    expect(result.downloadUrl).toBe(`${HUB_BASE_URL}/client/attachments/att%2Fodd%20id%3F`);
  });

  it('treats an envelope without a data field as the raw body', async () => {
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext());
    const xhr = await waitForXhr();
    xhr.respondWith(200, JSON.stringify({ code: 'ok', note: 'no data here' }));
    const result = await pending;

    expect(result.attachmentRef.name).toBe('hello.txt');
    expect(result.downloadUrl).toBe(`${HUB_BASE_URL}/client/attachments/undefined`);
  });

  it('keeps an empty original_name instead of falling back to the file name', async () => {
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext());
    const xhr = await waitForXhr();
    xhr.respondWith(
      200,
      hubEnvelope({ id: 'att-5', original_name: '', size: 3, mime_type: 'text/plain' }),
    );
    const result = await pending;

    expect(result.attachmentRef.name).toBe('');
    expect('original_name' in result.attachmentRef).toBe(false);
  });

  it('hashes an empty file to the SHA-256 of the empty string', async () => {
    const pending = uploadAttachmentWithProgress(makeFile('', 'empty.bin'), makeContext());
    const xhr = await waitForXhr();
    expect(requireBody(xhr).get('hash')).toBe(SHA256_EMPTY);

    xhr.respondWith(200, hubEnvelope(STORED_ATTACHMENT));
    await expect(pending).resolves.toBeTruthy();
  });

  it('skips the upload when probeHash reports the file already stored', async () => {
    const cachedRef: AttachmentRef = { id: 'att-3', name: 'cached.png', size: 9, mime_type: 'image/png' };
    const probeHash = vi.fn().mockResolvedValue({ exists: true, attachment: cachedRef });
    const progress: AttachmentUploadProgress[] = [];

    const result = await uploadAttachmentWithProgress(
      makeFile(),
      makeContext({ probeHash }),
      (p) => progress.push(p),
    );

    expect(probeHash).toHaveBeenCalledWith(SHA256_HELLO);
    expect(FakeXMLHttpRequest.instances).toHaveLength(0);
    expect(result.attachmentRef).toBe(cachedRef);
    expect(result.downloadUrl).toBe(`${HUB_BASE_URL}/client/attachments/att-3`);
    expect(progress).toEqual([
      { percent: 0, phase: 'hashing' },
      { percent: 10, phase: 'hashing' },
      { percent: 100, phase: 'done' },
    ]);
  });

  it('proceeds to upload when probeHash reports the file missing', async () => {
    const probeHash = vi.fn().mockResolvedValue({ exists: false });
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext({ probeHash }));

    const xhr = await waitForXhr();
    expect(probeHash).toHaveBeenCalledWith(SHA256_HELLO);
    xhr.respondWith(200, hubEnvelope(STORED_ATTACHMENT));

    const result = await pending;
    expect(result.attachmentRef.id).toBe('att-1');
  });

  it('proceeds to upload when probeHash reports exists without an attachment', async () => {
    const probeHash = vi.fn().mockResolvedValue({ exists: true });
    const pending = uploadAttachmentWithProgress(makeFile(), makeContext({ probeHash }));

    const xhr = await waitForXhr();
    xhr.respondWith(200, hubEnvelope(STORED_ATTACHMENT));
    const result = await pending;

    expect(result.attachmentRef.id).toBe('att-1');
  });

  it('propagates probeHash failures', async () => {
    const probeHash = vi.fn().mockRejectedValue(new Error('probe down'));
    await expect(
      uploadAttachmentWithProgress(makeFile(), makeContext({ probeHash })),
    ).rejects.toThrow('probe down');
  });

  it('falls back to fetch when XMLHttpRequest is unavailable', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => hubEnvelope(STORED_ATTACHMENT),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadAttachmentWithProgress(
      makeFile(),
      makeContext({ getToken: () => 'jwt-123' }),
    );

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call;
    expect(url).toBe(`${HUB_BASE_URL}/client/attachments`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string> | undefined)?.['Authorization']).toBe(
      'Bearer jwt-123',
    );

    const body = init?.body as FormData | undefined;
    expect(body?.get('hash')).toBe(SHA256_HELLO);
    expect(body?.get('original_name')).toBe('hello.txt');

    expect(result.attachmentRef).toEqual(expect.objectContaining({
      id: 'att-1',
      name: 'renamed.txt',
      hash: 'server-hash',
      url: `${HUB_BASE_URL}/client/attachments/att-1`,
    }));
  });

  it('rejects the fetch fallback on non-ok responses', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      text: async () => '',
    }));

    await expect(
      uploadAttachmentWithProgress(makeFile(), makeContext()),
    ).rejects.toThrow('Upload failed: HTTP 413');
  });

  it('omits the hash and uses an empty name in the fetch fallback when the server omits them', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => hubEnvelope({ id: 'att-6', size: 2, mime_type: 'text/plain' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadAttachmentWithProgress(makeFile(), makeContext());

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [, init] = call;
    expect(Object.keys((init?.headers ?? {}) as Record<string, string>)).toHaveLength(0);

    expect(result.attachmentRef.name).toBe('');
    expect('hash' in result.attachmentRef).toBe(false);
    expect('original_name' in result.attachmentRef).toBe(false);
  });
});

describe('uploadPendingAttachmentsWithProgress', () => {
  it('skips attachments that already have a ref or lack a file', async () => {
    const existingRef: AttachmentRef = { id: 'done-1', name: 'done.png', size: 1, mime_type: 'image/png' };
    const attachments: ComposerAttachment[] = [
      { id: 'a1', name: 'done.png', attachmentRef: existingRef },
      { id: 'a2', name: 'no-file.txt' },
      { id: 'a3', name: 'todo.txt', file: makeFile('data', 'todo.txt') },
    ];

    const pending = uploadPendingAttachmentsWithProgress(attachments, makeContext());
    const xhr = await waitForXhr();
    xhr.respondWith(
      200,
      hubEnvelope({ id: 'att-7', name: 'todo.txt', size: 4, mime_type: 'text/plain' }),
    );
    const result = await pending;

    expect(result[0]).toBe(attachments[0]);
    expect(result[1]).toBe(attachments[1]);
    expect(result[2]?.attachmentRef?.id).toBe('att-7');
    expect(attachments[2]?.attachmentRef).toBeUndefined();
  });

  it('keeps a failed attachment as-is so its text content is still sent', async () => {
    const attachments: ComposerAttachment[] = [
      { id: 'a1', name: 'flaky.txt', file: makeFile('data', 'flaky.txt') },
    ];

    const pending = uploadPendingAttachmentsWithProgress(attachments, makeContext());
    const xhr = await waitForXhr();
    xhr.failNetwork();
    const result = await pending;

    expect(result[0]).toBe(attachments[0]);
    expect(attachments[0]?.attachmentRef).toBeUndefined();
  });

  it('reports progress keyed by attachment index', async () => {
    const existingRef: AttachmentRef = { id: 'done-1', name: 'done.png', size: 1, mime_type: 'image/png' };
    const attachments: ComposerAttachment[] = [
      { id: 'a1', name: 'done.png', attachmentRef: existingRef },
      { id: 'a2', name: 'up.txt', file: makeFile('data', 'up.txt') },
    ];
    const events: Array<[number, AttachmentUploadProgress]> = [];

    const pending = uploadPendingAttachmentsWithProgress(
      attachments,
      makeContext(),
      (index, progress) => events.push([index, progress]),
    );
    const xhr = await waitForXhr();
    xhr.respondWith(200, hubEnvelope({ id: 'att-8', name: 'up.txt', size: 4, mime_type: 'text/plain' }));
    await pending;

    expect(events[0]).toEqual([1, { percent: 0, phase: 'hashing' }]);
    expect(events[events.length - 1]).toEqual([1, { percent: 100, phase: 'done' }]);
  });

  it('returns an empty array without touching the transport for empty input', async () => {
    const result = await uploadPendingAttachmentsWithProgress([], makeContext());
    expect(result).toEqual([]);
    expect(FakeXMLHttpRequest.instances).toHaveLength(0);
  });
});
