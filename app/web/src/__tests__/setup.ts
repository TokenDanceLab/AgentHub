import { vi } from 'vitest';

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
