import '@testing-library/jest-dom/vitest';
import { beforeAll, vi } from 'vitest';

// Shared test i18next instance (Issue #1717): real chatview + sharedWorkbench
// resources, isolated per project via i18next.createInstance(). Registered
// so every suite renders through the real `useTranslation` path without
// per-file react-i18next mocks and without NO_I18NEXT_INSTANCE noise.
// The default language is the helper's key-echo pseudo-language: suites
// outside the #1717 frozen-file boundary keep their raw-key visible
// behavior, while frozen suites opt into zh/en per file via
// useTestI18nLanguage().
import { installTestI18n } from '@shared/testing/i18n';
import { installJsdomPolyfills } from '@shared/testing/jsdomPolyfills';

installTestI18n();

// Global fetch mock for tests that hit network-bound code paths (mirrors the
// shared package setup). Tests can reset/override per suite via
// vi.mocked(fetch).mockImplementation.
globalThis.fetch = vi.fn();

// ──────────────────────────────────────────────────────────────
// Polyfills for jsdom — required once virtualization (virtua) landed.
// jsdom has no layout engine; see @shared/testing/jsdomPolyfills (#1678).
// ──────────────────────────────────────────────────────────────
installJsdomPolyfills();

// Re-export testing utilities so workbench component tests import from one
// place (same contract the shared package setup provided before #1759).
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
    preloadWorkbenchPage(() => import('../pages/ProjectsPage')),
    preloadWorkbenchPage(() => import('../pages/ContactsPage')),
    preloadWorkbenchPage(() => import('../pages/DocsPage')),
    preloadWorkbenchPage(() => import('../pages/AgentsPage')),
    preloadWorkbenchPage(() => import('../pages/TasksPage')),
    preloadWorkbenchPage(() => import('../pages/SettingsPage')),
  ]);
}, 30_000);
