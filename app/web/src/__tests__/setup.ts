import { vi } from 'vitest';
import { createElement, Fragment } from 'react';

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
// a no-op stub keeps it from throwing. Tests asserting on transcript ROW
// CONTENT mock `virtua` itself (passthrough Virtualizer) per-file. Mirrors
// shared setup.ts (RFC §6.4 / §8.2).
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
