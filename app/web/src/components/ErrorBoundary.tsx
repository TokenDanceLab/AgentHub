import { type ReactNode } from 'react';
import { ErrorBoundary as SharedErrorBoundary } from '@shared/ui';

/**
 * Web-platform ErrorBoundary wrapper.
 * - Shows stack traces only in development builds.
 */
export default function ErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <SharedErrorBoundary showStack={import.meta.env.DEV}>
      {children}
    </SharedErrorBoundary>
  );
}
