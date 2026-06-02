export type ThreadSelectionInput = string | { threadId?: unknown } | null | undefined;

export function resolveThreadSelectionId(input: ThreadSelectionInput): string | null {
  if (typeof input === 'string') return input.trim() || null;
  if (!input || typeof input !== 'object') return null;
  return typeof input.threadId === 'string' && input.threadId.trim() ? input.threadId : null;
}
