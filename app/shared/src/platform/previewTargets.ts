import type { EvidenceRef } from '../transcript';

export function resolveEvidencePreviewTarget(evidence: EvidenceRef): string | undefined {
  const directTarget = cleanTarget(evidence.uri) ?? cleanTarget(evidence.path);
  if (directTarget) return directTarget;

  const label = cleanTarget(evidence.label);
  if (!label) return undefined;

  if (isUrlLike(label) || isPathLike(label)) return label;
  return undefined;
}

function cleanTarget(value: string | undefined): string | undefined {
  const target = value?.trim();
  return target || undefined;
}

function isUrlLike(value: string): boolean {
  return /^(?:https?|file):\/\//i.test(value);
}

function isPathLike(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])/.test(value);
}
