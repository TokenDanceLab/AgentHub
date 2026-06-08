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

export function resolveCurrentTranscriptRunId(blocks: TranscriptBlock[]): string | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const runId = resolveBlockRunId(blocks[index]!);
    if (runId) return runId;
  }
  return undefined;
}

function resolveBlockRunId(block: TranscriptBlock): string | undefined {
  if (block.kind === 'run_step_group') {
    for (let index = block.children.length - 1; index >= 0; index -= 1) {
      const childRunId = resolveBlockRunId(block.children[index]!);
      if (childRunId) return childRunId;
    }
  }

  const rawRunId = rawRunIdFromBlock(block);
  if (rawRunId) return rawRunId;

  const runEvidence = [...(block.evidenceRefs ?? [])]
    .reverse()
    .find((ref) => ref.kind === 'run');
  return runEvidence ? rawRunIdFromEvidenceId(runEvidence.id) : undefined;
}

function rawRunIdFromBlock(block: TranscriptBlock): string | undefined {
  switch (block.kind) {
    case 'run_session':
    case 'subagent':
      return cleanRunId(block.runId);
    case 'child_agent':
      return cleanRunId(block.runId) ?? cleanRunId(block.parentRunId);
    default:
      return undefined;
  }
}

export function rawRunIdFromEvidenceId(evidenceId: string): string | undefined {
  const normalized = cleanRunId(evidenceId);
  if (!normalized?.startsWith('run-')) return undefined;
  return cleanRunId(normalized.slice(4));
}

function cleanRunId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
