import type { ComposerMention } from './types';

/** Key prefix for localStorage draft entries. */
const STORAGE_KEY_PREFIX = 'agenthub.composer.draft.';

/**
 * Draft data persisted to localStorage for a given session.
 * Stores text content and @mention references — enough to restore
 * the composer after a page refresh or tab switch.
 */
export interface ComposerDraft {
  text: string;
  mentions: ComposerMention[];
}

function storageKey(sessionId: string): string {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

function isValidDraft(raw: unknown): raw is ComposerDraft {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.text !== 'string') return false;
  if (!Array.isArray(obj.mentions)) return false;
  return obj.mentions.every(
    (m): boolean =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as Record<string, unknown>).id === 'string' &&
      typeof (m as Record<string, unknown>).label === 'string',
  );
}

/** Read a saved draft for the given session, or null if none exists. */
export function loadDraft(sessionId: string): ComposerDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist a draft for the given session. */
export function saveDraft(sessionId: string, draft: ComposerDraft): void {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(draft));
  } catch {
    // localStorage full or unavailable — silently ignore.
  }
}

/** Remove any saved draft for the given session. */
export function clearDraft(sessionId: string): void {
  try {
    localStorage.removeItem(storageKey(sessionId));
  } catch {
    // ignore
  }
}
