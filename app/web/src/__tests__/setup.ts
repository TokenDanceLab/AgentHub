import { vi } from 'vitest';
import { createElement, Fragment } from 'react';

// Shared test i18next instance (Issue #1717): isolated per-project instance
// with real chatview + sharedWorkbench resources. The default language is
// the helper's key-echo pseudo-language — web's frozen AuthPage/useWebAuth
// suites and App.test.tsx were written against raw-key echo (identity mocks
// / key-tolerant regexes), so they keep passing unchanged while the
// NO_I18NEXT_INSTANCE warning is eliminated. No web locale namespaces are
// loaded: no web suite asserts real translated copy for them.
import { installTestI18n } from '@shared/testing/i18n';
import { installJsdomPolyfills } from '@shared/testing/jsdomPolyfills';

installTestI18n();

// virtua Virtualizer needs a layout engine jsdom lacks — passthrough so
// transcript row content renders in integration tests (real Virtualizer is
// exercised by shared Transcript.autoscroll/virtualization tests).
vi.mock('virtua', () => ({
  Virtualizer: ({ children }: { children?: unknown }) =>
    createElement(Fragment, null, children as Parameters<typeof createElement>[2]),
}));

// ── Polyfills for jsdom — required once virtualization (virtua) landed ──
// jsdom has no layout engine: ResizeObserver never fires and scrollIntoView
// is unimplemented. virtua mounts a ResizeObserver per row + scroll container;
// a no-op stub keeps it from throwing. The global vi.mock('virtua') above
// is a passthrough so transcript row content renders in integration tests
// without the viewport measurement virtua can't perform in jsdom (the real
// Virtualizer is exercised by shared Transcript.autoscroll/virtualization
// tests). Shared helper — see @shared/testing/jsdomPolyfills (#1678).
installJsdomPolyfills();
