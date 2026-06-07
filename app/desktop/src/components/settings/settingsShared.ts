export const STORAGE_PREFIX = 'agenthub-settings.';

export const MODEL_OPTIONS = [
  ['auto', 'Auto'],
  ['opus[1m]', 'opus[1m]'],
  ['newapi/deepseek-v4-pro', 'newapi/deepseek-v4-pro'],
  ['deepseek-v4-pro', 'deepseek-v4-pro'],
  ['deepseek-v4-flash', 'deepseek-v4-flash'],
  ['gpt-5.5', 'gpt-5.5'],
  ['glm-5.1', 'glm-5.1'],
] as const;

export const PROVIDER_OPTIONS = [
  ['tokendance-gateway', 'TokenDance'],
  ['anthropic', 'Anthropic'],
  ['openai', 'OpenAI'],
  ['cc-switch-local', 'cc-switch local'],
] as const;

export const REASONING_OPTIONS = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['max', 'Max'],
] as const;
