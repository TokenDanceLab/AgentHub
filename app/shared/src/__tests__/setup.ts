import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

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

beforeAll(async () => {
  await Promise.allSettled([
    import('../workbench/pages/ProjectsPage'),
    import('../workbench/pages/ContactsPage'),
    import('../workbench/pages/DocsPage'),
    import('../workbench/pages/AgentsPage'),
    import('../workbench/pages/TasksPage'),
    import('../workbench/pages/SettingsPage'),
  ]);
});
