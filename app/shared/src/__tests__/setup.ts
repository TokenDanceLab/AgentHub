import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Shared test i18next instance (Issue #1717): real chatview + sharedWorkbench
// resources, isolated per project via i18next.createInstance(). Registered
// so every suite renders through the real `useTranslation` path without
// per-file react-i18next mocks and without NO_I18NEXT_INSTANCE noise.
// The default language is the helper's key-echo pseudo-language: suites that
// assert raw-key echo (e.g. TypingIndicator) keep their raw-key visible
// behavior, while suites that opt into zh/en per file via
// useTestI18nLanguage() get the real bundle.
import { installTestI18n } from '../testing/i18n';
import { installJsdomPolyfills } from '../testing/jsdomPolyfills';

installTestI18n();

// Shared fetch mock for eventClient tests.
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
// (orthogonal to RO). Shared helper — see ./testing/jsdomPolyfills (#1678).
// ──────────────────────────────────────────────────────────────
installJsdomPolyfills();

// Re-export testing utilities so shared component tests import from one place.
export { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
