import { type ReactNode } from 'react';
import ErrorBoundary, { type ErrorBoundaryExtension } from '../ui/ErrorBoundary';

/**
 * Page-level error boundary for workbench route gates.
 *
 * Reuses the shared {@link ErrorBoundary} UI (icon/title/description/stack +
 * retry/reload actions) and adds an {@link onReset} hook so the owning route
 * can clear transient state when the user retries — preventing the same render
 * error from immediately re-throwing after the boundary clears.
 *
 * Wraps each memoized route gate in {@link WorkbenchRoutes} so a
 * render crash in tasks/projects/docs stays isolated to that page instead of
 * tearing down the whole workbench shell.
 */
export interface PageErrorBoundaryProps {
  children: ReactNode;
  /** Platform-specific error extensions, forwarded to the shared boundary. */
  extensions?: ErrorBoundaryExtension[];
  /** Hide the stack trace details (default: shown). */
  showStack?: boolean;
  /**
   * Called when the user retries. Use this to reset route-local state
   * (e.g. close a preview, clear a draft) so retry does not re-throw.
   */
  onReset?: () => void;
}

export function PageErrorBoundary({
  children,
  extensions,
  showStack,
  onReset,
}: PageErrorBoundaryProps): ReactNode {
  // exactOptionalPropertyTypes: only assign `?:` props when defined so we
  // never pass an explicit `undefined` to the underlying ErrorBoundary.
  const boundaryProps: {
    extensions?: ErrorBoundaryExtension[];
    showStack?: boolean;
    onReset?: () => void;
  } = {};
  if (extensions !== undefined) boundaryProps.extensions = extensions;
  if (showStack !== undefined) boundaryProps.showStack = showStack;
  if (onReset !== undefined) boundaryProps.onReset = onReset;

  return <ErrorBoundary {...boundaryProps}>{children}</ErrorBoundary>;
}
