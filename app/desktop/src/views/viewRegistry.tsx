/**
 * Centralized view registry — maps every view slot to its component.
 * App.tsx renders slots by name instead of importing components directly.
 *
 * Component registration lives in @/config/viewRegistry (metadata + map).
 * This file provides the runtime `Slot` renderer and the MainView view-mode types.
 */
import { type ComponentType, type ReactNode } from 'react';
import { VIEW_REGISTRY as REGISTRY } from '@/config/viewRegistry';

// ── Derive slot→component mapping from config ──
const SLOT_TO_COMPONENT: Record<string, ComponentType<any>> = {};
for (const [key, cfg] of Object.entries(REGISTRY)) {
  SLOT_TO_COMPONENT[key] = cfg.component;
}

// Add internal-only slots not in the config metadata
import ErrorBoundary from '@/components/ErrorBoundary';
import ResizeHandle from '@/components/ResizeHandle';
SLOT_TO_COMPONENT['error-boundary'] = ErrorBoundary;
SLOT_TO_COMPONENT['resize-handle'] = ResizeHandle;

export type SlotName = keyof typeof SLOT_TO_COMPONENT;

// ── Slot renderer ──

interface SlotProps {
  name: SlotName;
  fallback?: ReactNode;
  [key: string]: unknown;
}

/** Render a view component by its slot name. */
export function Slot({ name, ...props }: SlotProps) {
  const Component = SLOT_TO_COMPONENT[name] as ComponentType<any>;
  return <Component {...props} />;
}

// ── Re-export config types (canonical source of truth) ──

export type { ViewMode, ViewDescriptor, ViewProps, ViewConfig } from '@/config/viewRegistry';
export { VIEWS, VIEW_LIST, getViewsForSlot, getView, isViewVisible } from '@/config/viewRegistry';

/** Layout slot derived from config (re-export for convenience). */
export type { ViewSlot as LayoutSlot } from '@/config/viewRegistry';
