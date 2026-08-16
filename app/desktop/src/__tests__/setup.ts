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

installTestI18n();

const LobeIconMock = () => null;

// Explicit named exports for every @lobehub/icons symbol used across
// the desktop test suite.  A Proxy does NOT work here — vitest v4
// statically validates that every consumer-visible export exists on the
// mock factory return, and Proxy traps are invisible to that check.
vi.mock('@lobehub/icons', () => ({
  Alibaba: LobeIconMock,
  AlibabaCloud: LobeIconMock,
  Anthropic: LobeIconMock,
  Aws: LobeIconMock,
  Azure: LobeIconMock,
  Bedrock: LobeIconMock,
  ByteDance: LobeIconMock,
  Claude: LobeIconMock,
  ClaudeCode: LobeIconMock,
  Codex: LobeIconMock,
  Cohere: LobeIconMock,
  DeepSeek: LobeIconMock,
  Doubao: LobeIconMock,
  Gemini: LobeIconMock,
  GeminiCLI: LobeIconMock,
  Google: LobeIconMock,
  Kimi: LobeIconMock,
  Meta: LobeIconMock,
  Minimax: LobeIconMock,
  Mistral: LobeIconMock,
  Moonshot: LobeIconMock,
  OpenCode: LobeIconMock,
  OpenAI: LobeIconMock,
  Perplexity: LobeIconMock,
  Qwen: LobeIconMock,
  Volcengine: LobeIconMock,
  XiaomiMiMo: LobeIconMock,
  Zhipu: LobeIconMock,
}));

vi.mock('@lobehub/icons/es/features/ProviderIcon/index.js', () => ({ default: LobeIconMock }));
vi.mock('@lobehub/icons/es/Antigravity/components/Color.js', () => ({ default: LobeIconMock }));

// Mock @lobehub/fluent-emoji (transitive peer dep of @lobehub/icons via @lobehub/ui)
// to prevent vitest from processing its ESM directory import which Node.js cannot resolve.
vi.mock('@lobehub/fluent-emoji', () => ({
  default: LobeIconMock,
  FluentEmoji: LobeIconMock,
  getEmoji: () => undefined,
  getEmojiNameByCharacter: () => undefined,
  getFluentEmojiCDN: () => '',
}));

// ─────────────────────────────────────────────────────────────────────
// jsdom polyfills for the virtualized Transcript (virtua landed in the
// shared chatview). jsdom has no layout engine:
// 1. ResizeObserver: virtua observes rows/container to measure dynamic
//    heights — a no-op stub keeps it from crashing (mirrors the shared
//    setup stub).
// 2. scrollIntoView: not implemented in jsdom; the Transcript highlight
//    effect calls it — stub as a no-op.
// 3. virtua Virtualizer: with a zero-height container it renders no
//    children, so transcript text never mounts in jsdom. Passthrough
//    mock keeps the whole transcript tree renderable in tests.
// ─────────────────────────────────────────────────────────────────────
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}
vi.mock('virtua', () => ({
  Virtualizer: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// ─────────────────────────────────────────────────────────────────────
// jsdom polyfills for the virtualized Transcript (virtua landed in the
// shared chatview). jsdom has no layout engine:
// 1. ResizeObserver: virtua observes rows/container to measure dynamic
//    heights — a no-op stub keeps it from crashing (mirrors the shared
//    setup stub).
// 2. scrollIntoView: not implemented in jsdom; the Transcript highlight
//    effect calls it — stub as a no-op.
// 3. virtua Virtualizer: with a zero-height container it renders no
//    children, so transcript text never mounts in jsdom. Passthrough
//    mock keeps the whole transcript tree renderable in tests.
// ─────────────────────────────────────────────────────────────────────
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

