import { useSyncExternalStore } from 'react';

export type ComposerSubmitBehavior = 'enter-send' | 'ctrl-enter-send';

export interface EngineeringColumnConversationPreference {
  collapsed: boolean;
  autoOpenSuppressed: boolean;
}

export const WORKBENCH_COMPOSER_SUBMIT_BEHAVIOR_KEY = 'agenthub.workbench.composerSubmitBehavior';
export const WORKBENCH_ENGINEERING_COLUMN_PREFERENCES_KEY =
  'agenthub.workbench.engineeringColumnByConversation.v1';

const DEFAULT_COMPOSER_SUBMIT_BEHAVIOR: ComposerSubmitBehavior = 'enter-send';
const listeners = new Set<() => void>();

function emitPreferenceChange(): void {
  for (const listener of listeners) listener();
}

function readEngineeringColumnPreferenceMap(): Record<string, EngineeringColumnConversationPreference> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WORKBENCH_ENGINEERING_COLUMN_PREFERENCES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, EngineeringColumnConversationPreference> = {};
    for (const [conversationId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const candidate = value as Partial<EngineeringColumnConversationPreference>;
      if (typeof candidate.collapsed !== 'boolean') continue;
      result[conversationId] = {
        collapsed: candidate.collapsed,
        autoOpenSuppressed: candidate.autoOpenSuppressed === true,
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function readEngineeringColumnPreference(
  conversationId: string | null | undefined,
): EngineeringColumnConversationPreference | undefined {
  const normalized = conversationId?.trim();
  if (!normalized) return undefined;
  return readEngineeringColumnPreferenceMap()[normalized];
}

export function writeEngineeringColumnPreference(
  conversationId: string,
  preference: EngineeringColumnConversationPreference,
): void {
  const normalized = conversationId.trim();
  if (!normalized || typeof window === 'undefined') return;
  try {
    const current = readEngineeringColumnPreferenceMap();
    current[normalized] = preference;
    window.localStorage.setItem(
      WORKBENCH_ENGINEERING_COLUMN_PREFERENCES_KEY,
      JSON.stringify(current),
    );
  } catch {
    // Quota / private-mode: the current interaction still works in memory.
  }
  emitPreferenceChange();
}

export function normalizeComposerSubmitBehavior(value: string | null | undefined): ComposerSubmitBehavior {
  return value === 'ctrl-enter-send' || value === 'Ctrl+Enter 发送'
    ? 'ctrl-enter-send'
    : DEFAULT_COMPOSER_SUBMIT_BEHAVIOR;
}

export function composerSubmitBehaviorLabel(value: ComposerSubmitBehavior): 'Enter 发送' | 'Ctrl+Enter 发送' {
  return value === 'ctrl-enter-send' ? 'Ctrl+Enter 发送' : 'Enter 发送';
}

export function composerSubmitBehaviorFromLabel(value: string): ComposerSubmitBehavior {
  return normalizeComposerSubmitBehavior(value);
}

export function readComposerSubmitBehavior(): ComposerSubmitBehavior {
  if (typeof window === 'undefined') return DEFAULT_COMPOSER_SUBMIT_BEHAVIOR;
  return normalizeComposerSubmitBehavior(window.localStorage.getItem(WORKBENCH_COMPOSER_SUBMIT_BEHAVIOR_KEY));
}

export function writeComposerSubmitBehavior(value: ComposerSubmitBehavior): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(WORKBENCH_COMPOSER_SUBMIT_BEHAVIOR_KEY, value);
  }
  emitPreferenceChange();
}

export function subscribeWorkbenchPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useComposerSubmitBehavior(): ComposerSubmitBehavior {
  return useSyncExternalStore(
    subscribeWorkbenchPreference,
    readComposerSubmitBehavior,
    readComposerSubmitBehavior,
  );
}
