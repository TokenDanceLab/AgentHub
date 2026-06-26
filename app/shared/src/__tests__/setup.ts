import '@testing-library/jest-dom/vitest';
import { beforeAll, vi } from 'vitest';

// Shared fetch mock for apiClient / eventClient tests.
// Tests can reset/override this per-suite via vi.mocked(fetch).mockImplementation.
globalThis.fetch = vi.fn();

// Re-export testing utilities so shared component tests import from one place.
export { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';

/* ──────────────────────────────────────────────────────────────
   Synchronous React.lazy preload for tests

   WorkbenchRoutes wraps every page component in React.lazy() +
   Suspense. In jsdom lazy imports resolve asynchronously which
   causes flaky "element not found" failures when tests navigate
   between rail pages and immediately query page content.

   Pre-resolving all lazy pages ensures the import Promise is
   fulfilled before any test renders a Suspense boundary.
   ────────────────────────────────────────────────────────────── */

const WORKBENCH_PRELOAD_TIMEOUT_MS = 5_000;

async function preloadWorkbenchPage(load: () => Promise<unknown>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    load(),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, WORKBENCH_PRELOAD_TIMEOUT_MS);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
}

beforeAll(async () => {
  await Promise.allSettled([
    preloadWorkbenchPage(() => import('../workbench/pages/ProjectsPage')),
    preloadWorkbenchPage(() => import('../workbench/pages/ContactsPage')),
    preloadWorkbenchPage(() => import('../workbench/pages/DocsPage')),
    preloadWorkbenchPage(() => import('../workbench/pages/AgentsPage')),
    preloadWorkbenchPage(() => import('../workbench/pages/TasksPage')),
    preloadWorkbenchPage(() => import('../workbench/pages/SettingsPage')),
  ]);
}, 30_000);
