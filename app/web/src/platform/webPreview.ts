import {
  createAttachmentImageUrlResolver,
  resolveEvidencePreviewTarget,
  type AttachmentImageUrlResolver,
} from '@shared/platform';
import type { AttachmentRef } from '@shared/composer';
import type { EvidenceRef } from '@shared/transcript';
import { HUB_URL } from '@/config';
import { getAccessToken } from '@/hooks/useAuth';
import { getCachedRefreshedAccessToken, refreshWebHubAccessTokenOnce } from './webAuthTokenRefresh';

export function canOpenWebEvidencePreview(evidence: EvidenceRef): boolean {
  return Boolean(resolveEvidencePreviewTarget(evidence));
}

export async function openWebEvidencePreview(evidence: EvidenceRef): Promise<void> {
  const target = resolveEvidencePreviewTarget(evidence);
  if (!target) {
    throw new Error(`No preview target for evidence: ${evidence.label}`);
  }

  window.open(target, '_blank', 'noopener,noreferrer');
}

/**
 * PreviewPort.resolveContentUrl for Web (#1817) — explicit capability boundary.
 * Web is Hub-only (root AGENTS §2): it never reaches a Local Edge or raw
 * runtime. Absolute http(s) evidence URLs (e.g. a runtime preview server
 * surfaced through Hub replay) render as-is, but host-relative Edge content
 * paths have no Web endpoint, so they resolve to `undefined` and the
 * inspector renders an honest "no content source" notice instead of a
 * broken frame against the Hub origin.
 */
export function resolveWebEvidenceContentUrl(contentRef: string): string | undefined {
  const trimmed = contentRef.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}

let webAttachmentImageResolver: AttachmentImageUrlResolver | undefined;

/**
 * PreviewPort.resolveAttachmentImageUrl for Web (#1938). Web is Hub-only
 * (root AGENTS boundary): image bytes are fetched from the Hub attachment
 * endpoint with the web access token — 401 triggers the single-flight
 * refresh hook and one retry — and surfaced to the transcript as a blob:
 * object URL. Web never reaches a Local Edge for attachment content.
 */
export function resolveWebAttachmentImageUrl(
  attachment: AttachmentRef,
): Promise<string | undefined> {
  webAttachmentImageResolver ??= createAttachmentImageUrlResolver({
    hubBaseUrl: HUB_URL,
    getToken: () => getCachedRefreshedAccessToken() ?? getAccessToken(),
    refreshAccessTokenOnce: refreshWebHubAccessTokenOnce,
  });
  return webAttachmentImageResolver(attachment);
}
