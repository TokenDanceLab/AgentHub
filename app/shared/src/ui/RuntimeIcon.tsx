import React from 'react';
import {
  ClaudeCode,
  Codex,
  GeminiCLI,
  ModelIcon,
  OpenCode,
  ProviderIcon,
} from '@lobehub/icons';

export type RuntimeIconKind = 'model' | 'provider' | 'runtime' | 'tool';

export type RuntimeIconSize = 'compact' | 'normal' | 'large';

export type RuntimeIconSource = 'lobehub' | 'fallback';

export type RuntimeIconFallback =
  | 'agenthub'
  | 'browser'
  | 'custom'
  | 'diff'
  | 'model'
  | 'provider'
  | 'read'
  | 'runtime'
  | 'search'
  | 'shell'
  | 'task'
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

export interface RuntimeIconProps {
  kind: RuntimeIconKind;
  name?: string | undefined;
  provider?: string | undefined;
  className?: string | undefined;
  size?: RuntimeIconSize | undefined;
  framed?: boolean | undefined;
  title?: string | undefined;
  decorative?: boolean | undefined;
}

const LOBE_RUNTIME_KEYS = new Set(['claude-code', 'codex', 'gemini-cli', 'opencode']);
const LOBE_PROVIDER_KEYS = new Set([
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
]);

const MODEL_PATTERNS = [
  /^claude[-\s]/,
  /^deepseek[-\s]/,
  /^doubao[-\s]/,
  /^gemini[-\s]/,
  /^glm[-\s]/,
  /^gpt[-\s]/,
  /^kimi[-\s]/,
  /^o[134][-\s]/,
  /^qwen[-\s]/,
];

export function resolveRuntimeIcon({
  kind,
  name,
  provider,
}: Pick<RuntimeIconProps, 'kind' | 'name' | 'provider'>): RuntimeIconResolution {
  const label = cleanRuntimeIconLabel(name || provider || kind);
  const normalizedModel = normalizeRuntimeIconModelKey(name);
  const normalizedProvider = normalizeRuntimeIconProviderKey(provider || name);
  const runtimeKey = normalizeRuntimeIconRuntimeKey(name);

  if (kind === 'runtime' && LOBE_RUNTIME_KEYS.has(runtimeKey)) {
    return {
      kind,
      label,
      source: 'lobehub',
      value: runtimeKey,
      fallback: 'runtime',
      lobeType: 'runtime',
    };
  }

  if (kind === 'provider' && normalizedProvider && LOBE_PROVIDER_KEYS.has(normalizedProvider)) {
    return {
      kind,
      label,
      source: 'lobehub',
      value: normalizedProvider,
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

  if (kind === 'model' && normalizedProvider && LOBE_PROVIDER_KEYS.has(normalizedProvider)) {
    return {
      kind,
      label,
      source: 'lobehub',
      value: normalizedProvider,
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

export function RuntimeIcon({
  kind,
  name,
  provider,
  className,
  size = 'normal',
  framed = true,
  title,
  decorative = false,
}: RuntimeIconProps): React.ReactElement {
  const resolution = resolveRuntimeIcon({ kind, name, provider });
  const label = title || resolution.label;
  const iconSize = runtimeIconPixelSize(size);

  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { 'aria-label': label, role: 'img', title: label })}
      className={className}
      data-runtime-brand-fallback={resolution.fallback}
      data-runtime-brand-kind={resolution.kind}
      data-runtime-brand-source={resolution.source}
      data-runtime-brand-value={resolution.value}
      data-runtime-icon-fallback={resolution.fallback}
      data-runtime-icon-kind={resolution.kind}
      data-runtime-icon-source={resolution.source}
      data-runtime-icon-value={resolution.value}
      style={runtimeIconFrameStyle(size, framed)}
    >
      {renderRuntimeIcon(resolution, iconSize)}
    </span>
  );
}

function renderRuntimeIcon(resolution: RuntimeIconResolution, iconSize: number): React.ReactNode {
  if (resolution.source === 'lobehub') {
    if (resolution.lobeType === 'runtime') return renderLobeRuntimeIcon(resolution.value, iconSize);
    if (resolution.lobeType === 'provider') return <ProviderIcon provider={resolution.value} size={iconSize} type="color" />;
    return <ModelIcon model={resolution.value} size={iconSize} />;
  }

  return runtimeIconFallbackSvg(resolution.fallback, iconSize);
}

function renderLobeRuntimeIcon(value: string, iconSize: number): React.ReactNode {
  if (value === 'claude-code') return <ClaudeCode size={iconSize} />;
  if (value === 'codex') return <Codex size={iconSize} />;
  if (value === 'gemini-cli') return <GeminiCLI size={iconSize} />;
  if (value === 'opencode') return <OpenCode size={iconSize} />;
  return runtimeIconFallbackSvg('runtime', iconSize);
}

function runtimeIconPixelSize(size: RuntimeIconSize): number {
  if (size === 'compact') return 16;
  if (size === 'large') return 24;
  return 18;
}

function runtimeIconBoxSize(size: RuntimeIconSize): number {
  if (size === 'compact') return 16;
  if (size === 'large') return 32;
  return 18;
}

function runtimeIconFrameStyle(size: RuntimeIconSize, framed: boolean): React.CSSProperties {
  const boxSize = runtimeIconBoxSize(size);
  return {
    alignItems: 'center',
    background: framed ? 'var(--surface-low, transparent)' : 'transparent',
    border: framed ? '1px solid var(--bdr, var(--border, transparent))' : '0',
    borderRadius: 'var(--r-sm, 6px)',
    color: 'var(--text-2, currentColor)',
    display: 'inline-flex',
    flex: 'none',
    height: boxSize,
    justifyContent: 'center',
    lineHeight: 1,
    overflow: 'hidden',
    width: boxSize,
  };
}

function normalizeRuntimeIconKey(value: string | undefined): string {
  return cleanRuntimeIconLabel(value)
    .toLowerCase()
    .replace(/[._/]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeRuntimeIconModelKey(value: string | undefined): string {
  return cleanRuntimeIconLabel(value)
    .toLowerCase()
    .replace(/[_/]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeRuntimeIconRuntimeKey(value: string | undefined): string {
  const key = normalizeRuntimeIconKey(value);
  if (key === 'claude' || key === 'claudecode') return 'claude-code';
  if (key === 'codex-cli' || key === 'openai-codex') return 'codex';
  if (key === 'gemini' || key === 'geminicli' || key === 'google-gemini-cli') return 'gemini-cli';
  if (key === 'open-code') return 'opencode';
  return key;
}

function normalizeRuntimeIconProviderKey(value: string | undefined): string {
  const key = normalizeRuntimeIconKey(value);
  if (!key) return '';
  if (key.includes('alibaba-cloud')) return 'alibabacloud';
  if (key.includes('alibaba') || key.includes('qwen')) return 'qwen';
  if (key.includes('anthropic')) return 'anthropic';
  if (key.includes('claude')) return 'claude';
  if (key.includes('azure') || key.includes('microsoft')) return 'azure';
  if (key.includes('bedrock')) return 'bedrock';
  if (key.includes('aws')) return 'aws';
  if (key.includes('bytedance') || key.includes('byte-dance') || key.includes('zijie')) return 'bytedance';
  if (key.includes('doubao')) return 'doubao';
  if (key.includes('volcengine')) return 'volcengine';
  if (key.includes('cohere')) return 'cohere';
  if (key.includes('deepseek')) return 'deepseek';
  if (key.includes('gemini')) return 'gemini';
  if (key.includes('google')) return 'google';
  if (key.includes('llama') || key.includes('meta')) return 'meta';
  if (key.includes('glm') || key.includes('zhipu')) return 'zhipu';
  if (key.includes('kimi') || key.includes('moonshot')) return 'moonshot';
  if (key.includes('mistral')) return 'mistral';
  if (key.includes('openai') || key.includes('gpt') || key.includes('codex')) return 'openai';
  if (key.includes('perplexity') || key.includes('sonar')) return 'perplexity';
  return key;
}

function isLikelyLobeModel(value: string): boolean {
  if (!value || value === 'auto') return false;
  return MODEL_PATTERNS.some((pattern) => pattern.test(value));
}

function runtimeIconFallbackFor(kind: RuntimeIconKind, label: string): RuntimeIconFallback {
  const key = normalizeRuntimeIconKey(label);
  if (key.includes('tokendance') || key.includes('agenthub') || key.includes('cc-switch')) return 'agenthub';
  if (key.includes('custom')) return 'custom';
  if (kind === 'tool') {
    if (key.includes('read')) return 'read';
    if (key.includes('write') || key.includes('edit') || key.includes('patch')) return 'write';
    if (key.includes('shell') || key.includes('bash') || key.includes('terminal')) return 'shell';
    if (key.includes('grep') || key.includes('glob') || key.includes('search') || key.includes('rg')) return 'search';
    if (key.includes('browser') || key.includes('web') || key.includes('screenshot')) return 'browser';
    if (key.includes('diff') || key.includes('git')) return 'diff';
    if (key.includes('task') || key.includes('subagent')) return 'task';
    return 'tool';
  }
  if (kind === 'provider') return 'provider';
  if (kind === 'model') return 'model';
  if (key.includes('browser')) return 'browser';
  return 'runtime';
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

function runtimeIconFallbackSvg(name: RuntimeIconFallback, iconSize: number): React.ReactNode {
  const common = {
    'aria-hidden': true,
    fill: 'none',
    height: iconSize,
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
    width: iconSize,
  } as const;

  switch (name) {
    case 'agenthub':
      return (
        <svg {...common}>
          <path d="M5 7h14v10H5z" />
          <path d="M8 10h8M8 14h5" />
          <path d="M12 3v4M12 17v4" />
        </svg>
      );
    case 'browser':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16M12 4c2 2.2 3 4.9 3 8s-1 5.8-3 8M12 4c-2 2.2-3 4.9-3 8s1 5.8 3 8" />
        </svg>
      );
    case 'custom':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M6 20v-1a6 6 0 0 1 12 0v1" />
          <path d="M18 5l2 2M20 5l-2 2" />
        </svg>
      );
    case 'diff':
      return (
        <svg {...common}>
          <path d="M6 5h12M6 12h12M6 19h12" />
          <path d="M9 9V3M15 21v-6" />
        </svg>
      );
    case 'model':
      return (
        <svg {...common}>
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </svg>
      );
    case 'provider':
      return (
        <svg {...common}>
          <path d="M12 3 4 7v10l8 4 8-4V7z" />
          <path d="M4 7l8 4 8-4M12 11v10" />
        </svg>
      );
    case 'read':
      return (
        <svg {...common}>
          <path d="M5 4h10l4 4v12H5z" />
          <path d="M14 4v5h5M8 13h8M8 17h5" />
        </svg>
      );
    case 'runtime':
      return (
        <svg {...common}>
          <rect x="4" y="8" width="16" height="11" rx="2" />
          <path d="M12 4v4M8 13h.01M16 13h.01M9 17h6" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15l5 5" />
        </svg>
      );
    case 'shell':
      return (
        <svg {...common}>
          <path d="M4 5h16v14H4z" />
          <path d="m7 9 3 3-3 3M12 15h5" />
        </svg>
      );
    case 'task':
      return (
        <svg {...common}>
          <path d="M5 7h10M5 12h8M5 17h6" />
          <path d="m16 17 2 2 4-5" />
        </svg>
      );
    case 'write':
      return (
        <svg {...common}>
          <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
          <path d="m13.5 8.5 2 2" />
        </svg>
      );
    case 'tool':
    default:
      return (
        <svg {...common}>
          <path d="m14.5 6.5 3 3" />
          <path d="M4 20l7.5-7.5" />
          <path d="M13 5a4 4 0 0 0 5 5l-8 8H6v-4z" />
        </svg>
      );
  }
}

export const resolveRuntimeBrandIcon = resolveRuntimeIcon;
export const RuntimeBrandIcon = RuntimeIcon;

export type RuntimeBrandIconKind = RuntimeIconKind;
export type RuntimeBrandIconProps = RuntimeIconProps;
export type RuntimeBrandIconResolution = RuntimeIconResolution;
export type RuntimeBrandIconSize = RuntimeIconSize;
export type RuntimeBrandIconSource = RuntimeIconSource;
