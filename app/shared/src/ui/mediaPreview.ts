/**
 * Media preview domain knowledge (#1939): extension detection, the
 * browser-native playability format cap, inline preview size thresholds,
 * and the player `src` scheme gate.
 *
 * Single source of truth shared by the workbench inspector router
 * (FilePreviewRouter / FilePreviewHelpers) and the chatview transcript
 * media attachment rows (MediaAttachment). Pure module — no React, no
 * platform port.
 *
 * Honesty contract: every cap/gate here maps to an explicit user-facing
 * notice at the call site. Nothing degrades into an empty player or a
 * binary dump.
 */

/** Media families the preview surfaces distinguish. */
export type MediaKind = 'audio' | 'video';

/**
 * Broad audio detection set — any of these extensions routes to the audio
 * branch instead of falling into the code viewer (which would render
 * binary garbage, the bug #1939 replaces). Members outside the playable
 * cap below get an explicit "unsupported format" notice, never a dead
 * player.
 */
const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus',
  'wma', 'aiff', 'aif', 'amr', 'mid', 'midi',
] as const;

/** Broad video detection set — same contract as AUDIO_EXTENSIONS. */
const VIDEO_EXTENSIONS = [
  'mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'wmv', 'flv', '3gp',
] as const;

/**
 * Format cap (playable subset): containers/codecs browsers decode natively.
 * Detected media outside this set renders an honest "unsupported format"
 * notice instead of a player that can only fail.
 *   audio: mp3/wav/ogg/oga (vorbis/opus)/m4a/aac/flac
 *   video: mp4/m4v (h.264/aac), webm (vp8/vp9/av1), ogv (theora), mov (h.264)
 */
const PLAYABLE_AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus',
] as const;

const PLAYABLE_VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'ogv', 'mov'] as const;

function fileExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0 || dot === lower.length - 1) return '';
  return lower.slice(dot + 1);
}

function matches(fileName: string, extensions: readonly string[]): boolean {
  return extensions.includes(fileExtension(fileName));
}

/** True when the filename extension is a known audio extension. */
export function isAudioFileName(fileName: string): boolean {
  return matches(fileName, AUDIO_EXTENSIONS);
}

/** True when the filename extension is a known video extension. */
export function isVideoFileName(fileName: string): boolean {
  return matches(fileName, VIDEO_EXTENSIONS);
}

/** Media kind for a filename, or undefined when it is not a media file. */
export function mediaKindForFileName(fileName: string): MediaKind | undefined {
  if (isAudioFileName(fileName)) return 'audio';
  if (isVideoFileName(fileName)) return 'video';
  return undefined;
}

/**
 * True when the filename is a detected media file AND inside the playable
 * format cap (browsers can decode it natively).
 */
export function isNativelyPlayableMediaFileName(fileName: string): boolean {
  return (
    matches(fileName, PLAYABLE_AUDIO_EXTENSIONS)
    || matches(fileName, PLAYABLE_VIDEO_EXTENSIONS)
  );
}

/**
 * Inline preview size thresholds (bytes). Rationale:
 * - Transcript rows fetch the whole attachment into a blob: object URL with
 *   the surface's Hub auth (Hub endpoints are not public), so the bytes
 *   land in memory — the caps bound that allocation.
 * - The inspector router streams from the content endpoint, but unbounded
 *   multi-GB media in an inline player is a UX dead end; the cap trades it
 *   for an honest "too large, download to play" notice.
 * Sizes at or under the cap preview; unknown sizes are NOT gated (the
 * mapper had no size to report — render the player and let it stream).
 */
export const MAX_PREVIEW_AUDIO_BYTES = 64 * 1024 * 1024; // 64 MiB
export const MAX_PREVIEW_VIDEO_BYTES = 256 * 1024 * 1024; // 256 MiB

/** Size threshold for one media kind. */
export function maxPreviewBytesForKind(kind: MediaKind): number {
  return kind === 'audio' ? MAX_PREVIEW_AUDIO_BYTES : MAX_PREVIEW_VIDEO_BYTES;
}

/**
 * True when `sizeBytes` is within the inline preview threshold for `kind`.
 * `undefined` passes: an unknown size cannot be gated honestly.
 */
export function isWithinPreviewSizeLimit(
  kind: MediaKind,
  sizeBytes: number | undefined,
): boolean {
  if (sizeBytes === undefined) return true;
  return sizeBytes <= maxPreviewBytesForKind(kind);
}

/** Human-readable rendering of a byte threshold for notices ("64 MB"). */
export function formatPreviewByteLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Userinfo in an http(s) authority (`user:pass@host`). Credentials in a
 * media URL would leak into the player request/history — same shape the
 * iframe preview gate rejects (#1933). Pure regex (no `new URL`) so the
 * behavior is identical across web, desktop and jsdom URL implementations.
 */
const USERINFO_AUTHORITY = /^https?:\/\/[^/?#]*@/i;

/**
 * Scheme gate for player `src` values (#1939 negative requirement): only
 * absolute http(s) URLs (without userinfo) and blob: object URLs created
 * by our own resolvers may reach `<audio>`/`<video> src`. Rejects
 * javascript:/data:/file:/vbscript:, protocol-relative (`//host`) and
 * relative URLs — unknown or dangerous schemes never enter a player.
 */
export function isSafeMediaSourceUrl(url: string): boolean {
  const trimmed = url.trim();
  if (/^blob:/i.test(trimmed)) return true;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  return !USERINFO_AUTHORITY.test(trimmed);
}
