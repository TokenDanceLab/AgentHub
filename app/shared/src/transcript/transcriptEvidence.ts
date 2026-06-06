import type { EvidenceRef, TranscriptBlock } from './types';

export function collectTranscriptEvidence(blocks: TranscriptBlock[]): EvidenceRef[] {
  const seen = new Set<string>();
  const evidence: EvidenceRef[] = [];

  for (const block of blocks) {
    for (const ref of block.evidenceRefs ?? []) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      evidence.push(ref);
    }
  }

  return evidence;
}
