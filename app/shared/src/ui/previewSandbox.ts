/**
 * iframe sandbox tokens for untrusted HTML previews.
 *
 * Hard rule: never combine `allow-scripts` with `allow-same-origin`.
 * That pair lets framed content de-sandbox itself / reach same-origin storage.
 */

/** srcDoc HTML previews (opaque origin when same-origin is omitted). */
export const PREVIEW_SANDBOX_SRCDOC = 'allow-scripts' as const;

/**
 * Remote / artifact URL previews.
 * Scripts may run, but the frame stays cross-origin to the parent.
 */
export const PREVIEW_SANDBOX_REMOTE = 'allow-scripts' as const;

/** True only for absolute http(s) URLs safe to load in a sandboxed iframe. */
const SAFE_REMOTE_PREVIEW_URL = /^https?:\/\//i;

/**
 * True only for http(s) URLs (explicit scheme + `//`) that are safe to load
 * in a sandboxed remote preview iframe. Rejects javascript:/data:/file:/blob:,
 * protocol-relative (`//host`) and relative URLs, which must not reach the
 * iframe `src`.
 */
export function isSafeRemotePreviewUrl(url: string): boolean {
  return SAFE_REMOTE_PREVIEW_URL.test(url.trim());
}
