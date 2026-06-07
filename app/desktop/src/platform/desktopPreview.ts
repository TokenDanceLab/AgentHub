import { open } from '@tauri-apps/plugin-shell';
import { resolveEvidencePreviewTarget } from '@shared/platform';
import type { EvidenceRef } from '@shared/transcript';

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
