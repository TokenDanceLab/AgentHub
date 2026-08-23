import React, { type ComponentType } from 'react';
// Subpath imports — avoids @lobehub/icons barrel (index.d.ts re-exports all 302 icons
// which fails under certain tsconfig contexts like web's moduleResolution + paths setup)
import ClaudeCode from '@lobehub/icons/es/ClaudeCode';
import Codex from '@lobehub/icons/es/Codex';
import GeminiCLI from '@lobehub/icons/es/GeminiCLI';
import OpenCode from '@lobehub/icons/es/OpenCode';
import Alibaba from '@lobehub/icons/es/Alibaba';
import AlibabaCloud from '@lobehub/icons/es/AlibabaCloud';
import Anthropic from '@lobehub/icons/es/Anthropic';
import Azure from '@lobehub/icons/es/Azure';
import Aws from '@lobehub/icons/es/Aws';
import Bedrock from '@lobehub/icons/es/Bedrock';
import ByteDance from '@lobehub/icons/es/ByteDance';
import Claude from '@lobehub/icons/es/Claude';
import Cohere from '@lobehub/icons/es/Cohere';
import DeepSeek from '@lobehub/icons/es/DeepSeek';
import Doubao from '@lobehub/icons/es/Doubao';
import Gemini from '@lobehub/icons/es/Gemini';
import Google from '@lobehub/icons/es/Google';
import Meta from '@lobehub/icons/es/Meta';
import Mistral from '@lobehub/icons/es/Mistral';
import Moonshot from '@lobehub/icons/es/Moonshot';
import OpenAI from '@lobehub/icons/es/OpenAI';
import Perplexity from '@lobehub/icons/es/Perplexity';
import Qwen from '@lobehub/icons/es/Qwen';
import Volcengine from '@lobehub/icons/es/Volcengine';
import Zhipu from '@lobehub/icons/es/Zhipu';
import { resolveRuntimeIconRegistry } from './runtimeIconRegistry';

export type RuntimeIconKind = 'model' | 'provider' | 'runtime' | 'tool';

export type RuntimeIconSize = 'compact' | 'normal' | 'large';

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

export function resolveRuntimeIcon({
  kind,
  name,
  provider,
}: Pick<RuntimeIconProps, 'kind' | 'name' | 'provider'>): RuntimeIconResolution {
  return resolveRuntimeIconRegistry({ kind, name, provider });
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
      {...(decorative
        ? { 'aria-hidden': true }
        : { 'aria-label': label, role: 'img', title: label })}
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

// ═══════════════════════════════════════════════════════════════════════
// Direct provider icon lookup — bypasses @lobehub/icons barrel
// (ProviderIcon pulls providerMappings → providerConfig → ALL 302 icons)
// Each entry maps a provider value (from runtimeIconRegistry) to a
// lobehub icon component with a .Color subcomponent.
// ═══════════════════════════════════════════════════════════════════════

type LobeIcon = ComponentType<{ size?: number }> & {
  Color?: ComponentType<{ size?: number }>;
};

const providerIconMap: Record<string, LobeIcon | undefined> = {
  alibaba: Alibaba,
  alibabacloud: AlibabaCloud,
  anthropic: Anthropic,
  azure: Azure,
  aws: Aws,
  bedrock: Bedrock,
  bytedance: ByteDance,
  claude: Claude,
  cohere: Cohere,
  deepseek: DeepSeek,
  doubao: Doubao,
  gemini: Gemini,
  google: Google,
  meta: Meta,
  mistral: Mistral,
  moonshot: Moonshot,
  openai: OpenAI,
  perplexity: Perplexity,
  qwen: Qwen,
  volcengine: Volcengine,
  zhipu: Zhipu,
};

// ═══════════════════════════════════════════════════════════════════════
// Direct model icon lookup — bypasses @lobehub/icons barrel
// (ModelIcon pulls modelMappings → modelConfig → ALL 302 icons)
// ═══════════════════════════════════════════════════════════════════════

const modelIconMap: Record<string, LobeIcon | undefined> = {
  claude: Claude,
  deepseek: DeepSeek,
  doubao: Doubao,
  gemini: Gemini,
  glm: Zhipu,       // ChatGLM → Zhipu icon
  gpt: OpenAI,
  kimi: Moonshot,
  qwen: Qwen,
  'o1': OpenAI,
  'o3': OpenAI,
  'o4': OpenAI,
};

function resolveModelIcon(modelName: string): LobeIcon | undefined {
  const key = modelName.toLowerCase().replace(/[._/]+/g, '-').replace(/[^a-z0-9-]+/g, '-');
  // Try exact match first, then prefix match (e.g. "claude-sonnet-4" → "claude")
  if (modelIconMap[key]) return modelIconMap[key];
  for (const [prefix, Icon] of Object.entries(modelIconMap)) {
    if (key.startsWith(prefix + '-') || key.startsWith(prefix)) return Icon;
  }
  return undefined;
}

function renderProviderColorIcon(provider: string, size: number): React.ReactNode {
  const Icon = providerIconMap[provider.toLowerCase()];
  const Color = Icon?.Color;
  if (Color) return <Color size={size} />;
  return runtimeIconFallbackSvg('provider', size);
}

function renderModelColorIcon(model: string, size: number): React.ReactNode {
  const Icon = resolveModelIcon(model);
  const Color = Icon?.Color;
  if (Color) return <Color size={size} />;
  return runtimeIconFallbackSvg('model', size);
}

function renderRuntimeIcon(resolution: RuntimeIconResolution, iconSize: number): React.ReactNode {
  if (resolution.source === 'lobehub') {
    if (resolution.lobeType === 'runtime') return renderLobeRuntimeIcon(resolution.value, iconSize);
    if (resolution.lobeType === 'provider') return renderProviderColorIcon(resolution.value, iconSize);
    return renderModelColorIcon(resolution.value, iconSize);
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
    background: framed ? 'var(--td-surface-2)' : 'transparent',
    border: framed ? '1px solid var(--td-line)' : '0',
    borderRadius: 'var(--td-radius-control)',
    color: 'var(--td-ink-muted)',
    display: 'inline-flex',
    flex: 'none',
    height: boxSize,
    justifyContent: 'center',
    lineHeight: 1,
    overflow: 'hidden',
    width: boxSize,
  };
}

function runtimeIconFallbackSvg(name: RuntimeIconFallback, iconSize: number): React.ReactNode {
  const common = {
    'aria-hidden': true,
    fill: 'none',
    height: iconSize,
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.9,
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
    case 'health':
      return (
        <svg {...common}>
          <path d="M4 13h4l2-6 4 10 2-4h4" />
          <path d="M12 21a8.5 8.5 0 0 1-8-8.5 5 5 0 0 1 8-3 5 5 0 0 1 8 3 8.5 8.5 0 0 1-8 8.5z" />
        </svg>
      );
    case 'mcp':
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <path d="M8 9v6M12 9v6M16 9v6" />
          <path d="M8 12h8" />
        </svg>
      );
    case 'model':
      return (
        <svg {...common}>
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </svg>
      );
    case 'profile':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M6 20v-1a6 6 0 0 1 12 0v1" />
          <path d="M18 4h2v2M20 4l-3 3" />
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
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
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
