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

installTestI18n();

// virtua Virtualizer needs a layout engine jsdom lacks — passthrough so
// transcript row content renders in integration tests (real Virtualizer is
// exercised by shared Transcript.autoscroll/virtualization tests).
vi.mock('virtua', () => ({
  Virtualizer: ({ children }: { children?: unknown }) =>
    createElement(Fragment, null, children as Parameters<typeof createElement>[2]),
}));

vi.mock('@lobehub/icons', () => ({
  Alibaba: () => null,
  AlibabaCloud: () => null,
  Anthropic: () => null,
  Aws: () => null,
  Azure: () => null,
  Bedrock: () => null,
  ByteDance: () => null,
  Claude: () => null,
  ClaudeCode: () => null,
  Codex: () => null,
  Cohere: () => null,
  DeepSeek: () => null,
  Doubao: () => null,
  Gemini: () => null,
  GeminiCLI: () => null,
  Google: () => null,
  Meta: () => null,
  Mistral: () => null,
  ModelIcon: () => null,
  Moonshot: () => null,
  OpenCode: () => null,
  OpenAI: () => null,
  Perplexity: () => null,
  ProviderIcon: () => null,
  Qwen: () => null,
  Volcengine: () => null,
  Zhipu: () => null,
}));

vi.mock('@lobehub/icons/es/Antigravity/components/Color.js', () => ({ default: () => null }));

// Mock @lobehub/fluent-emoji (transitive peer dep of @lobehub/icons via @lobehub/ui)
// to prevent vitest from processing its ESM directory import which Node.js cannot resolve.
vi.mock('@lobehub/fluent-emoji', () => ({
  default: () => null,
  FluentEmoji: () => null,
  getEmoji: () => undefined,
  getEmojiNameByCharacter: () => undefined,
  getFluentEmojiCDN: () => '',
}));

// ── Polyfills for jsdom — required once virtualization (virtua) landed ──
// jsdom has no layout engine: ResizeObserver never fires and scrollIntoView
// is unimplemented. virtua mounts a ResizeObserver per row + scroll container;
// a no-op stub keeps it from throwing. The global vi.mock('virtua') above
// is a passthrough so transcript row content renders in integration tests
// without the viewport measurement virtua can't perform in jsdom (the real
// Virtualizer is exercised by shared Transcript.autoscroll/virtualization
// tests). Mirrors shared + desktop setup.ts (RFC §6.4 / §8.2).
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
