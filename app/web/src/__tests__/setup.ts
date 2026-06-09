import { vi } from 'vitest';

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: () => null,
  Codex: () => null,
  GeminiCLI: () => null,
  ModelIcon: () => null,
  OpenCode: () => null,
  ProviderIcon: () => null,
}));

vi.mock('@lobehub/icons/es/Antigravity/components/Color.js', () => ({ default: () => null }));
