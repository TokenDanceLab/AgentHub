import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Shared test i18next instance (Issue #1717): real chatview + sharedWorkbench
// resources, isolated per project via i18next.createInstance(). Registered
// so every suite renders through the real `useTranslation` path without
// per-file react-i18next mocks and without NO_I18NEXT_INSTANCE noise.
// The default language is the helper's key-echo pseudo-language: suites that
// assert raw-key echo keep their raw-key visible behavior, while suites that
// opt into zh/en per file via useTestI18nLanguage() get the real bundle.
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
// place.
export { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';

// No lazy-page preload here: WorkbenchRoutes.tsx imports the pages statically,
// so there is nothing global to preload.
