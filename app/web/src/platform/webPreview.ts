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
