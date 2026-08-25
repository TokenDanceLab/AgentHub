import {
  createAttachmentImageUrlResolver,
  createAttachmentMediaUrlResolver,
  resolveEvidencePreviewTarget,
  type AttachmentImageUrlResolver,
  type AttachmentMediaUrlResolver,
} from '@shared/platform';
import type { AttachmentRef } from '@shared/composer';
import type { EvidenceRef } from '@shared/transcript';
import type { MediaKind } from '@shared/ui/mediaPreview';
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

/**
 * Artifact content download is deliberately NOT implemented on Web (#1945).
 *
 * Reachability assessment: Hub exposes runtime artifacts as a metadata-only
 * projection — `GET /web/agent-tasks/{id}/artifacts` returns artifact
 * metadata projected from run events and "does not expose content, apply, or
 * discard actions" (api/openapi.yaml). The only artifact content route in the
 * contract is the Edge-local `GET /v1/artifacts/{artifactId}/content`, which
 * is still `planned` and unreachable from Web anyway (Web is Hub-only and
 * never connects to a Local Edge). Therefore `PreviewPort.downloadArtifactContent`
 * is omitted on Web and the inspector degrades to the consistent
 * "download unavailable" notice (`inspector.artifactDownloadUnavailable`).
 */

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

let webAttachmentMediaResolver: AttachmentMediaUrlResolver | undefined;

/**
 * PreviewPort.resolveAttachmentMediaUrl for Web (#1939). Same Hub-only
 * boundary as the image resolver (#1938): audio/video bytes are fetched
 * from the Hub attachment endpoint with the web access token — 401 triggers
 * the single-flight refresh hook and one retry — and surfaced to the
 * transcript as a blob: object URL. Web never reaches a Local Edge for
 * attachment content.
 */
export function resolveWebAttachmentMediaUrl(
  attachment: AttachmentRef,
  kind: MediaKind,
): Promise<string | undefined> {
  webAttachmentMediaResolver ??= createAttachmentMediaUrlResolver({
    hubBaseUrl: HUB_URL,
    getToken: () => getCachedRefreshedAccessToken() ?? getAccessToken(),
    refreshAccessTokenOnce: refreshWebHubAccessTokenOnce,
  });
  return webAttachmentMediaResolver(attachment, kind);
}
