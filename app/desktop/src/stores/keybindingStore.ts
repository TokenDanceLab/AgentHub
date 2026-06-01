import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

export const BINDING_IDS = [
  'send',
  'newline',
  'search',
  'toggleSidebar',
  'toggleRunPanel',
  'close',
  'help',
] as const;

export type BindingId = (typeof BINDING_IDS)[number];

export const DEFAULT_BINDINGS: Record<BindingId, string[]> = {
  send: ['Enter'],
  newline: ['Shift', 'Enter'],
  search: ['Ctrl', 'K'],
  toggleSidebar: ['Ctrl', 'B'],
  toggleRunPanel: ['Ctrl', 'J'],
  close: ['Escape'],
  help: ['?'],
};

interface KeybindingState {
  bindings: Record<string, string[]>;
  setBinding: (id: BindingId, keys: string[]) => void;
  resetAll: () => void;
}

export const useKeybindingStore = create<KeybindingState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        bindings: {},
        setBinding: (id, keys) =>
          set((state) => ({
            bindings: { ...state.bindings, [id]: keys },
          })),
        resetAll: () => set({ bindings: {} }),
      }),
      {
        name: 'agenthub-keybindings',
      },
    ),
  ),
);

export function getBinding(id: BindingId): string[] {
  const state = useKeybindingStore.getState();
  return state.bindings[id] ?? DEFAULT_BINDINGS[id];
}
