import { open } from '@tauri-apps/plugin-shell';
import {
  createAttachmentImageUrlResolver,
  createAttachmentMediaUrlResolver,
  resolveEvidencePreviewTarget,
  type AttachmentImageUrlResolver,
  type AttachmentMediaUrlResolver,
  type DownloadArtifactInput,
} from '@shared/platform';
import type { RuntimeEvidenceContentRef } from '@shared/platform';
import type { AttachmentRef } from '@shared/composer';
import type { EvidenceRef } from '@shared/transcript';
import type { MediaKind } from '@shared/ui/mediaPreview';
import { isWorkbenchFixtureDataMode, resolveWorkbenchDataMode } from '@shared/demo';
import { getEdgeBaseUrl, HUB_URL } from '@/config';
import { getCachedRefreshedAccessToken } from '@/api/hubClient';
import { edgeAuthHeaders } from '@/api/edgeAuth';
import { getAccessToken } from '@/hooks/useAuth';

export function canOpenDesktopEvidencePreview(evidence: EvidenceRef): boolean {
  return Boolean(resolveEvidencePreviewTarget(evidence));
}

export async function openDesktopEvidencePreview(evidence: EvidenceRef): Promise<void> {
  const target = resolveEvidencePreviewTarget(evidence);
  if (!target) {
    throw new Error(`No preview target for evidence: ${evidence.label}`);
  }

  await open(target);
}

/**
 * PreviewPort.resolveContentUrl for Desktop (#1817).
 * Absolute http(s) URLs (e.g. a runtime preview server) are displayed as-is;
 * host-relative API paths (`/v1/runs/…/content`) are owned by the Local Edge,
 * so they are resolved against the Edge base URL. Anything else has no
 * displayable source and yields undefined (UI shows an honest notice).
 */
export function resolveDesktopEvidenceContentUrl(contentRef: string): string | undefined {
  const trimmed = contentRef.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    const edgeBase = getEdgeBaseUrl().replace(/\/+$/, '');
    if (!edgeBase) return undefined;
    return `${edgeBase}${trimmed}`;
  }
  return undefined;
}

/**
 * PreviewPort.resolveRuntimeEvidenceContent for Desktop (#1817).
 * Desktop owns the Local Edge connection, so it maps the shared structured
 * ref onto the Edge run content endpoint. This is the only place where the
 * Edge content path shape lives — shared code only carries the neutral ref.
 */
export function resolveDesktopRuntimeEvidenceContent(
  ref: RuntimeEvidenceContentRef,
): string | undefined {
  const edgeBase = getEdgeBaseUrl().replace(/\/+$/, '');
  if (!edgeBase) return undefined;
  const collection = ref.kind === 'artifact' ? 'artifacts' : 'previews';
  return `${edgeBase}/v1/runs/${ref.runId}/${collection}/${ref.id}/content`;
}

/**
 * PreviewPort.downloadArtifactContent for Desktop (#1945). Desktop owns the
 * Local Edge connection, so it maps the neutral artifact ref onto the Edge
 * content endpoint (via `resolveDesktopEvidenceContent`'s sibling above),
 * fetches the bytes with the Edge auth token, and hands them to the OS as a
 * real file download. The renderer never constructs the host REST path — the
 * endpoint shape lives only in `resolveDesktopRuntimeEvidenceContent`.
 * Throws when the content URL cannot be resolved or the fetch fails so the
 * inspector surfaces an explicit failure instead of a silent no-op.
 */
export async function downloadDesktopArtifactContent(input: DownloadArtifactInput): Promise<void> {
  const url = resolveDesktopRuntimeEvidenceContent(input.ref);
  if (!url) {
    throw new Error('Artifact content is not downloadable: Local Edge base URL is unavailable');
  }
  const headers = edgeAuthHeaders();
  const response = await fetch(url, { method: 'GET', ...(headers ? { headers } : {}) });
  if (!response.ok) {
    throw new Error(`Artifact content download failed with HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const filename = input.suggestedName?.trim() || input.ref.id;
  triggerBlobDownload(blob, filename);
}

/**
 * Save blob bytes as a user-facing file download via a transient anchor.
 * Uses the standard webview download path (object URL + `download` attribute)
 * so no extra host FS capability is required.
 */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Data-mode gate for Hub attachment fetches (#1995). The data-mode SSOT
 * (`@shared/demo/dataMode`) decides which backends a surface may contact:
 * pinned mock/fixture modes must not reach the Hub ("Hub and local Edge
 * are not contacted"), so both attachment resolvers then degrade to the
 * honest chip fallback (undefined, see attachmentMediaPort) instead of
 * issuing a live Hub request. auto/observed/approved-real keep the
 * authenticated Hub fetch unchanged. Resolved per call (not at
 * registration) so a runtime data-mode override takes effect without
 * re-creating the platform.
 */
function desktopDataModeAllowsHubAttachments(): boolean {
  return !isWorkbenchFixtureDataMode(
    resolveWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE),
  );
}

let desktopAttachmentImageResolver: AttachmentImageUrlResolver | undefined;

/**
 * PreviewPort.resolveAttachmentImageUrl for Desktop (#1938). Chat
 * attachments live on the Hub (the composer uploads them there), so
 * Desktop resolves them against HUB_URL with the desktop access token —
 * never through the Local Edge, keeping parity with Web. Desktop's thin
 * hub client does not export its single-flight refresh hook, so a 401
 * degrades to the honest chip fallback; the next regular Hub request
 * refreshes the token and a retry resolves the image.
 */
export function resolveDesktopAttachmentImageUrl(
  attachment: AttachmentRef,
): Promise<string | undefined> {
  if (!desktopDataModeAllowsHubAttachments()) return Promise.resolve(undefined);
  desktopAttachmentImageResolver ??= createAttachmentImageUrlResolver({
    hubBaseUrl: HUB_URL,
    getToken: () => getCachedRefreshedAccessToken() ?? getAccessToken(),
  });
  return desktopAttachmentImageResolver(attachment);
}

let desktopAttachmentMediaResolver: AttachmentMediaUrlResolver | undefined;

/**
 * PreviewPort.resolveAttachmentMediaUrl for Desktop (#1939). Same Hub-only
 * contract as the image resolver (#1938): chat attachments live on the Hub,
 * so audio/video bytes are resolved against HUB_URL with the desktop access
 * token — never through the Local Edge, keeping parity with Web.
 */
export function resolveDesktopAttachmentMediaUrl(
  attachment: AttachmentRef,
  kind: MediaKind,
): Promise<string | undefined> {
  if (!desktopDataModeAllowsHubAttachments()) return Promise.resolve(undefined);
  desktopAttachmentMediaResolver ??= createAttachmentMediaUrlResolver({
    hubBaseUrl: HUB_URL,
    getToken: () => getCachedRefreshedAccessToken() ?? getAccessToken(),
  });
  return desktopAttachmentMediaResolver(attachment, kind);
}
