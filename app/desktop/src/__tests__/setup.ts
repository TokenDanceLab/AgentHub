import React from 'react';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Shared test i18next instance (Issue #1717): isolated per-project instance
// with real chatview + sharedWorkbench resources. The default language is
// the helper's key-echo pseudo-language: desktop suites (AuthPage.test.tsx,
// LoginForm, AppShell, App.v4) were written against raw-key echo, so they
// keep passing unchanged while the NO_I18NEXT_INSTANCE warning disappears.
// Desktop's own translation namespace is not loaded — no desktop suite
// asserts real translated copy for it. This setup also hosts the shared
// suites in vitest.config.ts / vitest.shared-ci.config.ts, whose frozen
// files opt into zh/en per file via useTestI18nLanguage().
import { installTestI18n } from '@shared/testing/i18n';
import { installJsdomPolyfills } from '@shared/testing/jsdomPolyfills';

installTestI18n();

// ─────────────────────────────────────────────────────────────────────
// jsdom polyfills for the virtualized Transcript (virtua landed in the
// shared chatview). jsdom has no layout engine:
// 1. ResizeObserver: virtua observes rows/container to measure dynamic
//    heights — a no-op stub keeps it from crashing.
// 2. scrollIntoView: not implemented in jsdom; the Transcript highlight
//    effect calls it — stub as a no-op.
// Shared helper — see @shared/testing/jsdomPolyfills (#1678).
// ─────────────────────────────────────────────────────────────────────
installJsdomPolyfills();

// virtua Virtualizer: with a zero-height container it renders no children,
// so transcript text never mounts in jsdom. Passthrough mock keeps the
// whole transcript tree renderable in tests (the real Virtualizer is
// exercised by shared Transcript.autoscroll/virtualization tests).
vi.mock('virtua', () => ({
  Virtualizer: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
