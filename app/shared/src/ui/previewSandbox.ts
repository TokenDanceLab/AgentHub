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
 * Userinfo in the authority segment (`user:pass@host` before the first
 * path/query/fragment delimiter). Credentials in a preview URL would leak
 * into the framed request/history, and userinfo is a classic
 * authority-confusion shape (#1933). Checked as a pure regex (no `new URL`)
 * so behavior is identical across web, RN and jsdom URL implementations.
 */
const USERINFO_AUTHORITY = /^https?:\/\/[^/?#]*@/i;

/**
 * True only for http(s) URLs (explicit scheme + `//`) that are safe to load
 * in a sandboxed remote preview iframe. Rejects javascript:/data:/file:/blob:,
 * protocol-relative (`//host`) and relative URLs, which must not reach the
 * iframe `src`; also rejects userinfo-carrying URLs (#1933).
 */
export function isSafeRemotePreviewUrl(url: string): boolean {
  const trimmed = url.trim();
  return SAFE_REMOTE_PREVIEW_URL.test(trimmed) && !USERINFO_AUTHORITY.test(trimmed);
}
