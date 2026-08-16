/**
 * Single-source @lobehub/icons test mocks (#1678 test-system convergence).
 *
 * Web and desktop each used to maintain their own drifted copy of this mock
 * in their `src/__tests__/setup.ts`. Both copies now import from here so the
 * icon name list and the mocked deep paths can no longer drift apart.
 *
 * Why a per-name list instead of a Proxy:
 * - vitest v4 statically validates that every consumer-visible export exists
 *   on the mock factory return; Proxy traps are invisible to that check.
 * - The package root barrel (`@lobehub/icons`) is imported internally by the
 *   `@lobehub/icons/es/*` deep modules that app code actually imports, so the
 *   root must be mocked even though app source never imports it directly.
 *
 * The name list is the union of the two formerly drifted copies — i.e. the
 * set of names the shared/web/desktop suites actually resolve through the
 * root barrel. Extra names are harmless; a missing name fails the suite.
 */

/** Null-rendering stand-in for every mocked lobehub icon component. */
export const NullLobehubIcon = () => null;

/** Mock module shape for the `@lobehub/icons` package root barrel. */
export const lobehubIconsMock = {
  Alibaba: NullLobehubIcon,
  AlibabaCloud: NullLobehubIcon,
  Anthropic: NullLobehubIcon,
  Aws: NullLobehubIcon,
  Azure: NullLobehubIcon,
  Bedrock: NullLobehubIcon,
  ByteDance: NullLobehubIcon,
  Claude: NullLobehubIcon,
  ClaudeCode: NullLobehubIcon,
  Codex: NullLobehubIcon,
  Cohere: NullLobehubIcon,
  DeepSeek: NullLobehubIcon,
  Doubao: NullLobehubIcon,
  Gemini: NullLobehubIcon,
  GeminiCLI: NullLobehubIcon,
  Google: NullLobehubIcon,
  Kimi: NullLobehubIcon,
  Meta: NullLobehubIcon,
  Minimax: NullLobehubIcon,
  Mistral: NullLobehubIcon,
  ModelIcon: NullLobehubIcon,
  Moonshot: NullLobehubIcon,
  OpenCode: NullLobehubIcon,
  OpenAI: NullLobehubIcon,
  Perplexity: NullLobehubIcon,
  ProviderIcon: NullLobehubIcon,
  Qwen: NullLobehubIcon,
  Volcengine: NullLobehubIcon,
  XiaomiMiMo: NullLobehubIcon,
  Zhipu: NullLobehubIcon,
};

/**
 * Mock for the deep Antigravity color-icon module (imported by
 * `shared/src/workbench/designIcons.tsx`). The real module chain pulls in
 * assets Node cannot process in a jsdom test run.
 */
export const antigravityColorIconMock = { default: NullLobehubIcon };

/**
 * Mock for the ProviderIcon feature module pulled in by the Antigravity
 * color-icon chain. Historically only desktop mocked this path; it is
 * harmless for suites that never resolve it.
 */
export const providerIconFeatureMock = { default: NullLobehubIcon };
