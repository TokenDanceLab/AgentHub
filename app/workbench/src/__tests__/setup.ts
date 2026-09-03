import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

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

// No lazy-page preload here, deliberately.
//
// A `beforeAll` used to race six `import('../pages/*')` calls against a 5s
// timer so that React.lazy boundaries would already be resolved before any
// test rendered them. Both halves of that rationale are false on this tree:
// WorkbenchRoutes.tsx imports the pages statically (its own comment records
// that React.lazy was removed precisely because lazy cannot resolve
// synchronously under jsdom), and the preload never won its race anyway —
// measured locally, all six imports hit the 5s timer arm and then rejected with
// EnvironmentTeardownError once vitest tore the environment down. So it
// pre-resolved nothing while adding a flat ~5s to the `beforeAll` of every one
// of this package's ~169 test files (≈37-40% of the coverage lane's vitest
// wall, #2251 slice 3).
//
// If a page ever does become lazy again, the fix belongs in the tests that
// render it (await the content with findBy*/waitFor), not in a global timer
// that silently stops preloading the moment an import outgrows it.
