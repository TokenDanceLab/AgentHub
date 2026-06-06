import type { EvidenceRef, TranscriptBlock } from './types';

export function collectTranscriptEvidence(blocks: TranscriptBlock[]): EvidenceRef[] {
  const evidence: EvidenceRef[] = [];
  const indexById = new Map<string, number>();

  for (const block of blocks) {
    for (const ref of block.evidenceRefs ?? []) {
      const existingIndex = indexById.get(ref.id);
      if (existingIndex !== undefined) {
        evidence[existingIndex] = {
          ...evidence[existingIndex],
          ...ref,
        };
        continue;
      }
      indexById.set(ref.id, evidence.length);
      evidence.push(ref);
    }
  }

  return evidence;
}
