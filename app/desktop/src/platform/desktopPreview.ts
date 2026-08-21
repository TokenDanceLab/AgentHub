import { open } from '@tauri-apps/plugin-shell';
import { resolveEvidencePreviewTarget } from '@shared/platform';
import type { RuntimeEvidenceContentRef } from '@shared/platform';
import type { EvidenceRef } from '@shared/transcript';
import { getEdgeBaseUrl } from '@/config';

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
