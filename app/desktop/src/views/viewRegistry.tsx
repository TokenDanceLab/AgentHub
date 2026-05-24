/**
 * Centralized view registry — maps every view slot to its component.
 * App.tsx renders slots by name instead of importing components directly.
 *
 * Component registration lives in @/config/viewRegistry (metadata + map).
 * This file provides the runtime `Slot` renderer and the MainView view-mode types.
 */
import { type ComponentType, type ReactNode, Suspense, memo } from 'react';
import { VIEW_REGISTRY as REGISTRY } from '@/config/viewRegistry';
import ErrorBoundary from '@/components/ErrorBoundary';

// ── Derive slot→component mapping from config ──
const SLOT_TO_COMPONENT: Record<string, ComponentType<any>> = {};
for (const [key, cfg] of Object.entries(REGISTRY)) {
  SLOT_TO_COMPONENT[key] = cfg.component;
}

export type SlotName = keyof typeof SLOT_TO_COMPONENT;

// ── Slot renderer ──

interface SlotProps {
  name: string;
  fallback?: ReactNode;
  [key: string]: unknown;
}

/**
 * Render a view component by its slot name.
 *
 * Gracefully handles:
 * - Unknown names (renders fallback instead of crashing)
 * - Lazy components (auto-wraps in Suspense)
 * - Component errors (wraps in ErrorBoundary)
 */
export const Slot = memo(function Slot({ name, fallback, ...props }: SlotProps) {
  const Component = SLOT_TO_COMPONENT[name] as ComponentType<any> | undefined;

  if (!Component) {
    const msg = `[Slot] Unknown slot "${name}" — not registered. Available: ${Object.keys(SLOT_TO_COMPONENT).join(', ')}`;
    console.error(msg);
    // Render a visible diagnostic so broken slots never hide silently (React 19 renders <undefined /> as nothing).
    return (
      fallback ?? (
        <div
          style={{
            padding: 8,
            margin: 4,
            border: '1px dashed var(--color-danger, #e53e3e)',
            color: 'var(--color-danger, #e53e3e)',
            fontSize: 12,
            fontFamily: 'monospace',
            borderRadius: 4,
          }}
          role="alert"
        >
          {msg}
        </div>
      )
    );
  }

  // Detect lazy components: React.lazy wraps in a special $$typeof
  const isLazy =
    typeof Component === 'object' &&
    Component !== null &&
    (Component as any).$$typeof === Symbol.for('react.lazy');

  const inner = <Component {...props} />;

  return (
    <ErrorBoundary>
      {isLazy ? <Suspense fallback={fallback ?? null}>{inner}</Suspense> : inner}
    </ErrorBoundary>
  );
});

// ── Re-export config types (canonical source of truth) ──

export type { ViewMode, ViewDescriptor, ViewProps, ViewConfig } from '@/config/viewRegistry';
export { VIEWS, VIEW_LIST, getViewsForSlot, getView, isViewVisible } from '@/config/viewRegistry';

/** Layout slot derived from config (re-export for convenience). */
export type { ViewSlot as LayoutSlot } from '@/config/viewRegistry';
