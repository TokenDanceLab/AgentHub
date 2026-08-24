import { open } from '@tauri-apps/plugin-shell';
import {
  createAttachmentImageUrlResolver,
  resolveEvidencePreviewTarget,
  type AttachmentImageUrlResolver,
} from '@shared/platform';
import type { RuntimeEvidenceContentRef } from '@shared/platform';
import type { AttachmentRef } from '@shared/composer';
import type { EvidenceRef } from '@shared/transcript';
import { getEdgeBaseUrl, HUB_URL } from '@/config';
import { getCachedRefreshedAccessToken } from '@/api/hubClient';
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
  desktopAttachmentImageResolver ??= createAttachmentImageUrlResolver({
    hubBaseUrl: HUB_URL,
    getToken: () => getCachedRefreshedAccessToken() ?? getAccessToken(),
  });
  return desktopAttachmentImageResolver(attachment);
}
