import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  action?: ToastAction;
  exiting?: boolean;
}

export interface AddToastInput {
  type: ToastType;
  message: string;
  duration?: number;
  action?: ToastAction;
}

export type ToastOptions = Omit<AddToastInput, 'type' | 'message'>;

interface ToastState {
  toasts: ToastItem[];
  addToast: (input: AddToastInput) => string;
  showToast: (type: ToastType, message: string, options?: Omit<AddToastInput, 'type' | 'message'>) => string;
  dismissToast: (id: string) => void;
  removeToast: (id: string) => void;
}

const DEFAULT_DURATION = 4000;
const EXIT_ANIMATION_MS = 300;

let nextId = 0;

function scheduleAutoDismiss(
  set: (fn: (state: ToastState) => Partial<ToastState>) => void,
  id: string,
  duration: number,
) {
  if (duration > 0) {
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.map((t) =>
          t.id === id ? { ...t, exiting: true } : t,
        ),
      }));
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, EXIT_ANIMATION_MS);
    }, duration);
  }
}

function enqueueToast(
  set: (fn: (state: ToastState) => Partial<ToastState>) => void,
  input: AddToastInput,
): string {
  const id = `toast-${++nextId}`;

  set((state) => {
    const item: ToastItem = { id, type: input.type, message: input.message };
    if (input.duration !== undefined) item.duration = input.duration;
    if (input.action) item.action = input.action;
    const next = [...state.toasts, item];
    return { toasts: next.length > 5 ? next.slice(next.length - 5) : next };
  });

  scheduleAutoDismiss(set, id, input.duration ?? DEFAULT_DURATION);
  return id;
}

export const useToastStore = create<ToastState>()(
  subscribeWithSelector((set) => ({
    toasts: [],

    addToast: (input) => enqueueToast(set, input),

    showToast: (type, message, options) =>
      enqueueToast(set, { type, message, ...options }),

    dismissToast: (id) => {
      set((state) => ({
        toasts: state.toasts.map((t) =>
          t.id === id ? { ...t, exiting: true } : t,
        ),
      }));
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, EXIT_ANIMATION_MS);
    },

    removeToast: (id) => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    },
  })),
);
