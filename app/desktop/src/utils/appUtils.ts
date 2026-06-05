/**
 * Shared utilities extracted from App.tsx.
 *
 * Functions that don't depend on React state — pure helpers, localStorage
 * readers/writers, and small predicates.
 */
import type { ChatMessage } from '@/components/ChatView.types';

// ── Numeric ──

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ── Run status predicates ──

export function isRunActiveStatus(status: string | undefined): boolean {
  if (!status) return false;
  return [
    'queued',
    'running',
    'streaming',
    'waiting_for_input',
    'RUNNING',
    'STREAMING',
    'WAITING_FOR_INPUT',
  ].includes(status);
}

export function getActiveRunConflictId(error: unknown): string | undefined {
  // AppError checked at runtime — no static import to avoid circular deps
  const e = error as { status?: number; code?: string; details?: { runId?: string } };
  if (e.status !== 409 || e.code !== 'active_run_exists') return undefined;
  const runId = e.details?.runId;
  return typeof runId === 'string' && runId.length > 0 ? runId : undefined;
}

// ── DOM helpers ──

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input,textarea,select,[contenteditable]'));
}

export function focusComposer(): void {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label], textarea[placeholder]',
  );
  if (!textarea) return;
  textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => textarea.focus(), 120);
}

export function setComposerDraft(text: string): void {
  window.dispatchEvent(
    new CustomEvent('agenthub:set-composer-draft', { detail: { text } }),
  );
}

// ── Hidden messages (localStorage-backed per-thread) ──

export const HIDDEN_MESSAGES_STORAGE_PREFIX = 'agenthub.chat.hiddenMessages.';

export function hiddenMessagesStorageKey(threadId: string): string {
  return `${HIDDEN_MESSAGES_STORAGE_PREFIX}${threadId}`;
}

export function readHiddenMessageIds(threadId: string | null | undefined): Set<string> {
  if (!threadId || typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(hiddenMessagesStorageKey(threadId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is string => typeof value === 'string' && value.length > 0),
    );
  } catch {
    return new Set();
  }
}

export function writeHiddenMessageIds(threadId: string | null | undefined, ids: Set<string>): void {
  if (!threadId || typeof window === 'undefined') return;
  try {
    const key = hiddenMessagesStorageKey(threadId);
    if (ids.size === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // localStorage can be unavailable in restricted browser contexts; in-memory hiding still works.
  }
}

export function hideMessages(messages: ChatMessage[], hiddenIds: Set<string>): ChatMessage[] {
  if (hiddenIds.size === 0) return messages;
  return messages.filter((message) => !hiddenIds.has(message.id));
}

// ── Team run predicates ──

export function isTeamRunActiveStatus(status: string | undefined): boolean {
  if (!status) return false;
  return ['queued', 'planning', 'dispatching', 'running', 'waiting_for_approval', 'merging'].includes(
    status,
  );
}

export function isPendingTeamApprovalStatus(status: string | undefined): boolean {
  if (!status) return false;
  return ['pending', 'requested', 'waiting', 'waiting_for_approval'].includes(
    status.toLowerCase(),
  );
}

// ── Environment detection ──

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

// ── Focus source tracking constants ──

export const FOCUS_NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
