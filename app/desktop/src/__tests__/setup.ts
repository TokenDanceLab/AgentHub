import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

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
