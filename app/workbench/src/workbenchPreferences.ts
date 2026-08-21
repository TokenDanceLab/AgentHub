import { useSyncExternalStore } from 'react';

export type ComposerSubmitBehavior = 'enter-send' | 'ctrl-enter-send';

export const WORKBENCH_COMPOSER_SUBMIT_BEHAVIOR_KEY = 'agenthub.workbench.composerSubmitBehavior';

const DEFAULT_COMPOSER_SUBMIT_BEHAVIOR: ComposerSubmitBehavior = 'enter-send';
const listeners = new Set<() => void>();

function emitPreferenceChange(): void {
  for (const listener of listeners) listener();
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
