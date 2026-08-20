import { resolveEvidencePreviewTarget } from '@shared/platform';
import type { EvidenceRef } from '@shared/transcript';

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
 * surfaced through Hub replay) render as-is, but host-relative Edge API paths
 * (`/v1/runs/…/content`) have no Web endpoint, so they resolve to `undefined`
 * and the inspector renders an honest "no content source" notice instead of
 * a broken frame against the Hub origin.
 */
export function resolveWebEvidenceContentUrl(contentRef: string): string | undefined {
  const trimmed = contentRef.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}
