/**
 * Surface-agnostic factory for `PreviewPort.resolveAttachmentImageUrl` (#1938).
 *
 * Hub serves `GET /client/attachments/:id` behind the Hub-session auth
 * middleware, so a plain `<img src>` cannot carry the Bearer token. The
 * resolver therefore fetches the bytes with the surface's own token and
 * hands the transcript a blob: object URL. Surfaces supply their auth
 * materials (token getter + optional single-flight 401 refresh) and Hub
 * base URL; all fetch/cache/degrade logic lives here once.
 *
 * Honesty contract: any failure (missing id, signed-out, non-2xx after the
 * optional refresh retry, non-image bytes, network error) yields
 * `undefined` so the row degrades to the file chip with an explicit status
 * notice — never a silent broken image.
 */
import type { AttachmentRef } from '../composer/types';
import { buildAttachmentDownloadUrl } from '../hub/hubClientPayloadBodies';
import type { AttachmentImageUrlResolver } from './attachmentImagePort';

export interface AttachmentImageUrlResolverDeps {
  /** Hub base URL the surface talks to (trailing slashes are trimmed). */
  hubBaseUrl: string;
  /** Current Hub access token; null when signed out. */
  getToken: () => string | null;
  /**
   * Optional single-flight 401 recovery (Web wires its refresh hook).
   * When absent, a 401 degrades to the chip fallback immediately.
   */
  refreshAccessTokenOnce?: () => Promise<string | null>;
  /** Injectable fetch for tests / surface-specific transports. */
  fetchImpl?: typeof fetch;
  /** Max cached object URLs before FIFO eviction revokes the oldest. */
  cacheLimit?: number;
}

const DEFAULT_CACHE_LIMIT = 64;

export function createAttachmentImageUrlResolver(
  deps: AttachmentImageUrlResolverDeps,
): AttachmentImageUrlResolver {
  const baseUrl = deps.hubBaseUrl.trim().replace(/\/+$/, '');
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const cacheLimit = deps.cacheLimit ?? DEFAULT_CACHE_LIMIT;
  /** Map insertion order doubles as the FIFO eviction queue. */
  const urlCache = new Map<string, string>();
  const inflight = new Map<string, Promise<string | undefined>>();

  function evictIfNeeded(): void {
    while (urlCache.size > cacheLimit) {
      const oldest = urlCache.keys().next().value;
      if (oldest === undefined) break;
      const evicted = urlCache.get(oldest);
      urlCache.delete(oldest);
      if (evicted) URL.revokeObjectURL(evicted);
    }
  }

  async function fetchOnce(id: string, token: string | null): Promise<Response> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return doFetch(buildAttachmentDownloadUrl(baseUrl, id), { method: 'GET', headers });
  }

  return async function resolveAttachmentImageUrl(
    attachment: AttachmentRef,
  ): Promise<string | undefined> {
    const id = attachment.id?.trim();
    if (!id || !baseUrl) return undefined;

    const cached = urlCache.get(id);
    if (cached !== undefined) {
      // Touch for FIFO freshness, then reuse the live object URL.
      urlCache.delete(id);
      urlCache.set(id, cached);
      return cached;
    }
    const pending = inflight.get(id);
    if (pending) return pending;

    const task = (async (): Promise<string | undefined> => {
      try {
        let res = await fetchOnce(id, deps.getToken());
        if (res.status === 401 && deps.refreshAccessTokenOnce) {
          const refreshed = await deps.refreshAccessTokenOnce();
          if (refreshed) res = await fetchOnce(id, refreshed);
        }
        if (!res.ok) return undefined;
        const blob = await res.blob();
        // Hub echoes the stored mime; reject non-image bytes so the row
        // degrades honestly instead of rendering a broken thumbnail.
        if (blob.type && !blob.type.startsWith('image/')) return undefined;
        const objectUrl = URL.createObjectURL(blob);
        urlCache.set(id, objectUrl);
        evictIfNeeded();
        return objectUrl;
      } catch {
        return undefined;
      } finally {
        inflight.delete(id);
      }
    })();
    inflight.set(id, task);
    return task;
  };
}
