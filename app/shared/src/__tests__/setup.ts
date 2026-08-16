import '@testing-library/jest-dom/vitest';
import { beforeAll, vi } from 'vitest';

// Shared test i18next instance (Issue #1717): real chatview + sharedWorkbench
// resources, isolated per project via i18next.createInstance(). Registered
// so every suite renders through the real `useTranslation` path without
// per-file react-i18next mocks and without NO_I18NEXT_INSTANCE noise.
// The default language is the helper's key-echo pseudo-language: suites
// outside the #1717 frozen-file boundary (e.g. TypingIndicator) keep their
// raw-key visible behavior, while frozen suites opt into zh/en per file via
// useTestI18nLanguage().
import { installTestI18n } from '../testing/i18n';
import { installJsdomPolyfills } from '../testing/jsdomPolyfills';

installTestI18n();

// Shared fetch mock for eventClient tests (apiClient.ts removed per RFC A-V3 §4.1).
// Tests can reset/override this per-suite via vi.mocked(fetch).mockImplementation.
globalThis.fetch = vi.fn();

// ──────────────────────────────────────────────────────────────
// Polyfills for jsdom — required once virtualization (virtua) landed.
//
// jsdom has no layout engine: clientHeight/offsetHeight/scrollHeight are 0,
// ResizeObserver never fires, and scrollIntoView is unimplemented. virtua
// mounts a ResizeObserver per visible row and on the scroll container; a
// no-op stub keeps it from throwing. Tests that assert on transcript ROW
// CONTENT mock `virtua` itself (a passthrough Virtualizer) so children
// render without the viewport measurement virtua can't perform in jsdom;
// tests that assert on the SCROLL CONTRACT keep the real Virtualizer and
// mock clientHeight/scrollTop/scrollHeight directly on `.transcript`
// (orthogonal to RO). Mirrors codeg's test-setup.ts (frontend.md Q9).
// (RFC §6.4 / §8.2)
// Shared helper — see ./testing/jsdomPolyfills (#1678).
// ──────────────────────────────────────────────────────────────
installJsdomPolyfills();

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
