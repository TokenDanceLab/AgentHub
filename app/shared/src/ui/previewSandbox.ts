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
