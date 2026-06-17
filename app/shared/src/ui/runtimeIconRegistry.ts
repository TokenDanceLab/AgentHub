export type RuntimeIconKind = 'model' | 'provider' | 'runtime' | 'tool';

export type RuntimeIconSource = 'lobehub' | 'fallback';

export type RuntimeIconFallback =
  | 'agenthub'
  | 'browser'
  | 'custom'
  | 'diff'
  | 'health'
  | 'mcp'
  | 'model'
  | 'profile'
  | 'provider'
  | 'read'
  | 'runtime'
  | 'search'
  | 'shell'
  | 'task'
  | 'target'
  | 'tool'
  | 'write';

export interface RuntimeIconResolution {
  kind: RuntimeIconKind;
  label: string;
  source: RuntimeIconSource;
  value: string;
  fallback: RuntimeIconFallback;
  lobeType?: 'model' | 'provider' | 'runtime';
}

export interface RuntimeIconRegistryInput {
  kind: RuntimeIconKind;
  name?: string | undefined;
  provider?: string | undefined;
}

export interface RuntimeIconRegistry {
  runtimes: Record<string, { value: string; lobeType: 'runtime' }>;
  runtimeAliases: Record<string, string>;
  providers: Record<string, { value: string; lobeType: 'provider' }>;
  providerAliases: Array<{ includes: string[]; value: string }>;
  modelPatterns: RegExp[];
  internalFallbacks: string[];
  toolFallbacks: Record<RuntimeIconFallback, string[]>;
}

export const runtimeIconRegistry: RuntimeIconRegistry = {
  runtimes: {
    'claude-code': { value: 'claude-code', lobeType: 'runtime' },
    codex: { value: 'codex', lobeType: 'runtime' },
    'gemini-cli': { value: 'gemini-cli', lobeType: 'runtime' },
    opencode: { value: 'opencode', lobeType: 'runtime' },
  },
  runtimeAliases: {
    claude: 'claude-code',
    claudecode: 'claude-code',
    'codex-cli': 'codex',
    'openai-codex': 'codex',
    gemini: 'gemini-cli',
    geminicli: 'gemini-cli',
    'google-gemini-cli': 'gemini-cli',
    'open-code': 'opencode',
  },
  providers: Object.fromEntries(
    [
      'alibaba',
      'alibabacloud',
      'anthropic',
      'azure',
      'aws',
      'bedrock',
      'bytedance',
      'claude',
      'cohere',
      'deepseek',
      'doubao',
      'example',
      'gemini',
      'google',
      'meta',
      'mistral',
      'moonshot',
      'openai',
      'opencode',
      'perplexity',
      'qwen',
      'volcengine',
      'zhipu',
    ].map((value) => [value, { value, lobeType: 'provider' as const }])
  ),
  providerAliases: [
    { includes: ['alibaba-cloud'], value: 'alibabacloud' },
    { includes: ['alibaba', 'qwen'], value: 'qwen' },
    { includes: ['anthropic'], value: 'anthropic' },
    { includes: ['claude'], value: 'claude' },
    { includes: ['azure', 'microsoft'], value: 'azure' },
    { includes: ['bedrock'], value: 'bedrock' },
    { includes: ['aws'], value: 'aws' },
    { includes: ['bytedance', 'byte-dance', 'zijie'], value: 'bytedance' },
    { includes: ['doubao'], value: 'doubao' },
    { includes: ['volcengine'], value: 'volcengine' },
    { includes: ['cohere'], value: 'cohere' },
    { includes: ['deepseek'], value: 'deepseek' },
    { includes: ['example'], value: 'example' },
    { includes: ['gemini'], value: 'gemini' },
    { includes: ['google'], value: 'google' },
    { includes: ['llama', 'meta'], value: 'meta' },
    { includes: ['glm', 'zhipu'], value: 'zhipu' },
    { includes: ['kimi', 'moonshot'], value: 'moonshot' },
    { includes: ['mistral'], value: 'mistral' },
    { includes: ['openai', 'gpt', 'codex'], value: 'openai' },
    { includes: ['perplexity', 'sonar'], value: 'perplexity' },
  ],
  modelPatterns: [
    /^claude[-\s]/,
    /^deepseek[-\s]/,
    /^doubao[-\s]/,
    /^gemini[-\s]/,
    /^glm[-\s]/,
    /^gpt[-\s]/,
    /^kimi[-\s]/,
    /^o[134][-\s]/,
    /^qwen[-\s]/,
  ],
  internalFallbacks: ['tokendance', 'agenthub', 'cc-switch'],
  toolFallbacks: {
    agenthub: [],
    browser: ['browser', 'web', 'screenshot'],
    custom: ['custom'],
    diff: ['diff', 'git'],
    health: ['health', 'heartbeat', 'status'],
    mcp: ['mcp', 'model-context-protocol'],
    model: [],
    profile: ['profile', 'agent-profile', 'agentprofile'],
    provider: [],
    read: ['read'],
    runtime: [],
    search: ['grep', 'glob', 'search', 'ripgrep', 'rg'],
    shell: ['shell', 'bash', 'terminal'],
    task: ['task', 'subagent'],
    target: ['target', 'execution-target', 'desktop-edge', 'local-edge', 'remote-edge'],
    tool: [],
    write: ['write', 'edit', 'patch'],
  },
};

export function resolveRuntimeIconRegistry({
  kind,
  name,
  provider,
}: RuntimeIconRegistryInput): RuntimeIconResolution {
  const label = cleanRuntimeIconLabel(name || provider || kind);
  const normalizedModel = normalizeRuntimeIconModelKey(name);
  const normalizedProvider = normalizeRuntimeIconProviderKey(provider || name);
  const runtimeKey = normalizeRuntimeIconRuntimeKey(name);

  if (kind === 'runtime' && runtimeIconRegistry.runtimes[runtimeKey]) {
    return {
      kind,
      label,
      source: 'lobehub',
      value: runtimeIconRegistry.runtimes[runtimeKey].value,
      fallback: 'runtime',
      lobeType: 'runtime',
    };
  }

  if (
    kind === 'provider' &&
    normalizedProvider &&
    runtimeIconRegistry.providers[normalizedProvider]
  ) {
    return {
      kind,
      label,
      source: 'lobehub',
      value: runtimeIconRegistry.providers[normalizedProvider].value,
      fallback: 'provider',
      lobeType: 'provider',
    };
  }

  if (kind === 'model' && normalizedModel && isLikelyLobeModel(normalizedModel)) {
    return {
      kind,
      label,
      source: 'lobehub',
      value: normalizedModel,
      fallback: 'model',
      lobeType: 'model',
    };
  }

  if (kind === 'model' && normalizedProvider && runtimeIconRegistry.providers[normalizedProvider]) {
    return {
      kind,
      label,
      source: 'lobehub',
      value: runtimeIconRegistry.providers[normalizedProvider].value,
      fallback: 'model',
      lobeType: 'provider',
    };
  }

  return {
    kind,
    label,
    source: 'fallback',
    value: runtimeIconFallbackValue(kind, label),
    fallback: runtimeIconFallbackFor(kind, label),
  };
}

export function normalizeRuntimeIconKey(value: string | undefined): string {
  return cleanRuntimeIconLabel(value)
    .toLowerCase()
    .replace(/→/g, '-')
    .replace(/[._/]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeRuntimeIconModelKey(value: string | undefined): string {
  return cleanRuntimeIconLabel(value)
    .toLowerCase()
    .replace(/→/g, '-')
    .replace(/[_/]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeRuntimeIconRuntimeKey(value: string | undefined): string {
  const key = normalizeRuntimeIconKey(value);
  return runtimeIconRegistry.runtimeAliases[key] ?? key;
}

function normalizeRuntimeIconProviderKey(value: string | undefined): string {
  const key = normalizeRuntimeIconKey(value);
  if (!key) return '';
  for (const alias of runtimeIconRegistry.providerAliases) {
    if (alias.includes.some((part) => key.includes(part))) return alias.value;
  }
  return key;
}

function isLikelyLobeModel(value: string): boolean {
  if (!value || value === 'auto') return false;
  return runtimeIconRegistry.modelPatterns.some((pattern) => pattern.test(value));
}

function runtimeIconFallbackFor(kind: RuntimeIconKind, label: string): RuntimeIconFallback {
  const key = normalizeRuntimeIconKey(label);
  if (runtimeIconRegistry.internalFallbacks.some((part) => key.includes(part))) return 'agenthub';
  if (kind === 'tool') {
    for (const [fallback, keywords] of Object.entries(runtimeIconRegistry.toolFallbacks) as Array<
      [RuntimeIconFallback, string[]]
    >) {
      if (keywords.some((part) => runtimeIconKeywordMatches(key, part))) return fallback;
    }
    return 'tool';
  }
  if (kind === 'provider') return 'provider';
  if (kind === 'model') return 'model';
  if (key.includes('health') || key.includes('heartbeat') || key.includes('status')) return 'health';
  if (key.includes('mcp') || key.includes('model-context-protocol')) return 'mcp';
  if (key.includes('agent-profile') || key.includes('agentprofile') || key.includes('profile')) return 'profile';
  if (key.includes('target') || key.includes('edge')) return 'target';
  if (key.includes('custom')) return 'custom';
  if (key.includes('browser')) return 'browser';
  return 'runtime';
}

function runtimeIconKeywordMatches(key: string, part: string): boolean {
  if (part.length <= 2) return key.split('-').includes(part);
  return key.includes(part);
}

function runtimeIconFallbackValue(kind: RuntimeIconKind, label: string): string {
  const ascii = label.match(/[A-Za-z0-9]+/g);
  if (ascii?.length) {
    return ascii
      .slice(0, kind === 'tool' ? 1 : 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }
  const chars = Array.from(label);
  return chars.slice(0, 2).join('').toUpperCase() || kind.slice(0, 1).toUpperCase();
}

function cleanRuntimeIconLabel(value: string | undefined): string {
  return (value ?? '').trim() || 'Unknown';
}
