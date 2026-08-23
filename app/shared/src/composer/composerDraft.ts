import type { AttachmentRef, ComposerMention, ComposerAttachment, QuoteContext, ReplyToContext } from './types';

/** Key prefix for localStorage draft entries. */
const STORAGE_KEY_PREFIX = 'agenthub.composer.draft.';

/**
 * Serializable projection of a ComposerAttachment.
 *
 * `File` objects cannot be serialized, so only attachments that already
 * carry a Hub `attachmentRef` survive a localStorage round trip. Attachments
 * still uploading (no ref) stay in the in-memory pending draft of the
 * UnifiedComposer so a *same-session* conversation switch keeps them; after
 * a hard reload they are intentionally absent (the file is gone — restoring
 * a chip without a ref and without a file would silently send nothing).
 */
export interface SerializedDraftAttachment {
  id: string;
  name: string;
  size?: number;
  mime?: string;
  attachmentRef: AttachmentRef;
}

/**
 * Draft data persisted to localStorage for a given session.
 * Stores text content, @mention references, uploaded attachment refs and
 * the reply/quote context of the draft.
 */
export interface ComposerDraft {
  text: string;
  mentions: ComposerMention[];
  /** Uploaded attachments only (see {@link SerializedDraftAttachment}). */
  attachments?: SerializedDraftAttachment[];
  replyTo?: ReplyToContext | null;
  quote?: QuoteContext | null;
}

function storageKey(sessionId: string): string {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

function isValidDraftAttachment(raw: unknown): raw is SerializedDraftAttachment {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string') return false;
  if (typeof obj.name !== 'string') return false;
  const ref = obj.attachmentRef;
  if (!ref || typeof ref !== 'object') return false;
  const refObj = ref as Record<string, unknown>;
  // Minimal ref validation — id + name + size are the fields consumers use;
  // mime_type is required by AttachmentRef (#1853 review: a ref without it
  // is malformed and must not be restored into composer state).
  return (
    typeof refObj.id === 'string'
    && typeof refObj.name === 'string'
    && typeof refObj.size === 'number'
    && typeof refObj.mime_type === 'string'
  );
}

function isValidDraft(raw: unknown): raw is ComposerDraft {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.text !== 'string') return false;
  if (!Array.isArray(obj.mentions)) return false;
  if (!obj.mentions.every(
    (m): boolean =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as Record<string, unknown>).id === 'string' &&
      typeof (m as Record<string, unknown>).label === 'string',
  )) {
    return false;
  }
  if (obj.attachments !== undefined) {
    if (!Array.isArray(obj.attachments)) return false;
    if (!obj.attachments.every(isValidDraftAttachment)) return false;
  }
  if (obj.replyTo != null) {
    const replyTo = obj.replyTo as Record<string, unknown>;
    if (typeof replyTo !== 'object') return false;
    if (typeof replyTo.messageId !== 'string') return false;
    if (typeof replyTo.author !== 'string') return false;
    if (typeof replyTo.preview !== 'string') return false;
  }
  if (obj.quote != null) {
    const quote = obj.quote as Record<string, unknown>;
    if (typeof quote !== 'object') return false;
    if (typeof quote.text !== 'string') return false;
  }
  return true;
}

/**
 * Build the serialized draft for a composer snapshot. Only attachments with
 * a Hub ref are included (File objects cannot round-trip localStorage).
 */
export function serializeDraft(input: {
  text: string;
  mentions: ComposerMention[];
  attachments?: ComposerAttachment[];
  replyTo?: ReplyToContext | null;
  quote?: QuoteContext | null;
}): ComposerDraft {
  const attachments = (input.attachments ?? [])
    .filter((a): a is ComposerAttachment & { attachmentRef: AttachmentRef } => Boolean(a.attachmentRef))
    .map((a) => ({
      id: a.id,
      name: a.name,
      ...(a.size !== undefined ? { size: a.size } : {}),
      ...(a.mime !== undefined ? { mime: a.mime } : {}),
      attachmentRef: a.attachmentRef!,
    }));
  return {
    text: input.text,
    mentions: input.mentions,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(input.replyTo != null ? { replyTo: input.replyTo } : {}),
    ...(input.quote != null ? { quote: input.quote } : {}),
  };
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
