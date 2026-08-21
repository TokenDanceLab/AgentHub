import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from './__tests__/setup';
import {
  RuntimeBrandIcon,
  resolveRuntimeBrandIcon,
} from './RuntimeBrandIcon';

vi.mock('@lobehub/icons', () => {
  const span = (props?: Record<string, unknown>) => React.createElement('span', props ?? {});
  const iconWithColor = (name: string) => {
    const Icon = ({ size }: { size?: number }) => <span data-icon={name} data-size={size} data-testid={`${name}-icon`} />;
    Icon.Color = ({ size }: { size?: number }) => <span data-icon={name} data-size={size} data-testid={`${name}-color-icon`} />;
    return Icon;
  };
  return {
    Alibaba: iconWithColor('alibaba'),
    AlibabaCloud: iconWithColor('alibabacloud'),
    Anthropic: iconWithColor('anthropic'),
    Azure: iconWithColor('azure'),
    Aws: iconWithColor('aws'),
    Bedrock: iconWithColor('bedrock'),
    ByteDance: iconWithColor('bytedance'),
    Claude: iconWithColor('claude'),
    ClaudeCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="claude-code-icon" />,
    Cohere: iconWithColor('cohere'),
    Codex: ({ size }: { size?: number }) => <span data-size={size} data-testid="codex-icon" />,
    DeepSeek: iconWithColor('deepseek'),
    Doubao: iconWithColor('doubao'),
    Gemini: iconWithColor('gemini'),
    GeminiCLI: ({ size }: { size?: number }) => <span data-size={size} data-testid="gemini-cli-icon" />,
    Google: iconWithColor('google'),
    Meta: iconWithColor('meta'),
    Mistral: iconWithColor('mistral'),
    ModelIcon: ({ model, size }: { model: string; size?: number }) => <span data-model={model} data-size={size} data-testid="model-icon" />,
    Moonshot: iconWithColor('moonshot'),
    OpenCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="opencode-icon" />,
    OpenAI: iconWithColor('openai'),
    Perplexity: iconWithColor('perplexity'),
    ProviderIcon: ({ provider, size }: { provider: string; size?: number }) => <span data-provider={provider} data-size={size} data-testid="provider-icon" />,
    Qwen: iconWithColor('qwen'),
    Volcengine: iconWithColor('volcengine'),
    Zhipu: iconWithColor('zhipu'),
  };
});

function mkColorIcon(tag: string) {
  const Icon = ({ size }: { size?: number }) => <span data-icon={tag} data-size={size} data-testid={`${tag}-icon`} />;
  Icon.Color = ({ size }: { size?: number }) => <span data-icon={tag} data-size={size} data-testid={`${tag}-color-icon`} />;
  return { default: Icon };
}
function mkRuntimeIcon(testid: string) {
  return { default: ({ size }: { size?: number }) => <span data-size={size} data-testid={testid} /> };
}

vi.mock('@lobehub/icons/es/Alibaba', () => mkColorIcon('alibaba'));
vi.mock('@lobehub/icons/es/AlibabaCloud', () => mkColorIcon('alibabacloud'));
vi.mock('@lobehub/icons/es/Anthropic', () => mkColorIcon('anthropic'));
vi.mock('@lobehub/icons/es/Azure', () => mkColorIcon('azure'));
vi.mock('@lobehub/icons/es/Aws', () => mkColorIcon('aws'));
vi.mock('@lobehub/icons/es/Bedrock', () => mkColorIcon('bedrock'));
vi.mock('@lobehub/icons/es/ByteDance', () => mkColorIcon('bytedance'));
vi.mock('@lobehub/icons/es/Claude', () => mkColorIcon('claude'));
vi.mock('@lobehub/icons/es/ClaudeCode', () => mkRuntimeIcon('claude-code-icon'));
vi.mock('@lobehub/icons/es/Codex', () => mkRuntimeIcon('codex-icon'));
vi.mock('@lobehub/icons/es/Cohere', () => mkColorIcon('cohere'));
vi.mock('@lobehub/icons/es/DeepSeek', () => mkColorIcon('deepseek'));
vi.mock('@lobehub/icons/es/Doubao', () => mkColorIcon('doubao'));
vi.mock('@lobehub/icons/es/Gemini', () => mkColorIcon('gemini'));
vi.mock('@lobehub/icons/es/GeminiCLI', () => mkRuntimeIcon('gemini-cli-icon'));
vi.mock('@lobehub/icons/es/Google', () => mkColorIcon('google'));
vi.mock('@lobehub/icons/es/Meta', () => mkColorIcon('meta'));
vi.mock('@lobehub/icons/es/Mistral', () => mkColorIcon('mistral'));
vi.mock('@lobehub/icons/es/Moonshot', () => mkColorIcon('moonshot'));
vi.mock('@lobehub/icons/es/OpenAI', () => mkColorIcon('openai'));
vi.mock('@lobehub/icons/es/OpenCode', () => mkRuntimeIcon('opencode-icon'));
vi.mock('@lobehub/icons/es/Perplexity', () => mkColorIcon('perplexity'));
vi.mock('@lobehub/icons/es/Qwen', () => mkColorIcon('qwen'));
vi.mock('@lobehub/icons/es/Volcengine', () => mkColorIcon('volcengine'));
vi.mock('@lobehub/icons/es/Zhipu', () => mkColorIcon('zhipu'));
vi.mock('@lobehub/icons/es/Antigravity/components/Color.js', () => ({ default: () => null }));

describe('RuntimeBrandIcon', () => {
  it('resolves known runtimes to LobeHub runtime icons', () => {
    expect(resolveRuntimeBrandIcon({ kind: 'runtime', name: 'Claude Code' })).toMatchObject({
      source: 'lobehub',
      value: 'claude-code',
      lobeType: 'runtime',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'runtime', name: 'OpenCode' })).toMatchObject({
      source: 'lobehub',
      value: 'opencode',
      lobeType: 'runtime',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'runtime', name: 'Gemini CLI' })).toMatchObject({
      source: 'lobehub',
      value: 'gemini-cli',
      lobeType: 'runtime',
    });
  });

  it('maps known providers and models to LobeHub helper components', () => {
    expect(resolveRuntimeBrandIcon({ kind: 'provider', name: 'OpenAI' })).toMatchObject({
      source: 'lobehub',
      value: 'openai',
      lobeType: 'provider',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'provider', name: 'Claude' })).toMatchObject({
      source: 'lobehub',
      value: 'claude',
      lobeType: 'provider',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'provider', name: 'Anthropic' })).toMatchObject({
      source: 'lobehub',
      value: 'anthropic',
      lobeType: 'provider',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'model', name: 'gpt-5-codex' })).toMatchObject({
      source: 'lobehub',
      value: 'gpt-5-codex',
      lobeType: 'model',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'model', name: 'internal-pro', provider: 'DeepSeek' })).toMatchObject({
      source: 'lobehub',
      value: 'deepseek',
      lobeType: 'provider',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'provider', name: 'Gemini' })).toMatchObject({
      source: 'lobehub',
      value: 'gemini',
      lobeType: 'provider',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'provider', name: 'Example AI' })).toMatchObject({
      source: 'lobehub',
      value: 'example',
      lobeType: 'provider',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'provider', name: 'Doubao' })).toMatchObject({
      source: 'lobehub',
      value: 'doubao',
      lobeType: 'provider',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'model', name: 'glm-5.1' })).toMatchObject({
      source: 'lobehub',
      value: 'glm-5.1',
      lobeType: 'model',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'model', name: 'claude-sonnet-4-20250514' })).toMatchObject({
      source: 'lobehub',
      value: 'claude-sonnet-4-20250514',
      lobeType: 'model',
    });
  });

  it('keeps internal TokenDance and AgentHub providers on branded fallbacks', () => {
    expect(resolveRuntimeBrandIcon({ kind: 'provider', name: 'TokenDance Gateway' })).toMatchObject({
      source: 'fallback',
      fallback: 'agenthub',
      value: 'TG',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'provider', name: 'cc-switch' })).toMatchObject({
      source: 'fallback',
      fallback: 'agenthub',
      value: 'CS',
    });
  });

  it('normalizes OpenAI-compatible custom providers to the OpenAI brand', () => {
    expect(resolveRuntimeBrandIcon({ kind: 'provider', name: 'Custom OpenAI-compatible' })).toMatchObject({
      source: 'lobehub',
      value: 'openai',
      lobeType: 'provider',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'model', name: 'routing-fast', provider: 'OpenAI Compatible API' })).toMatchObject({
      source: 'lobehub',
      value: 'openai',
      lobeType: 'provider',
    });
  });

  it('falls back to local compact icons for internal runtimes and tools', () => {
    expect(resolveRuntimeBrandIcon({ kind: 'runtime', name: 'Browser Worker' })).toMatchObject({
      source: 'fallback',
      fallback: 'browser',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'runtime', name: 'Custom Agent' })).toMatchObject({
      source: 'fallback',
      fallback: 'custom',
      value: 'CA',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'runtime', name: 'Open Code' })).toMatchObject({
      source: 'lobehub',
      value: 'opencode',
      lobeType: 'runtime',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'tool', name: 'Git Diff' })).toMatchObject({
      source: 'fallback',
      fallback: 'diff',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'tool', name: 'apply_patch' })).toMatchObject({
      source: 'fallback',
      fallback: 'write',
    });
  });

  it('uses specific fallbacks for MCP, AgentProfile, target, and health surfaces', () => {
    expect(resolveRuntimeBrandIcon({ kind: 'tool', name: 'MCP Server' })).toMatchObject({
      source: 'fallback',
      fallback: 'mcp',
      value: 'M',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'runtime', name: 'Agent Profile' })).toMatchObject({
      source: 'fallback',
      fallback: 'profile',
      value: 'AP',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'tool', name: 'Execution Target' })).toMatchObject({
      source: 'fallback',
      fallback: 'target',
      value: 'E',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'tool', name: 'Target Health' })).toMatchObject({
      source: 'fallback',
      fallback: 'health',
      value: 'T',
    });
  });

  it('renders source metadata for tests', () => {
    render(
      <div>
        <RuntimeBrandIcon kind="runtime" name="Codex" />
        <RuntimeBrandIcon kind="runtime" name="Gemini CLI" size="large" />
        <RuntimeBrandIcon kind="provider" name="OpenAI" size="compact" />
        <RuntimeBrandIcon kind="tool" name="Shell" />
      </div>,
    );

    expect(screen.getByLabelText('Codex')).toHaveAttribute('data-runtime-brand-source', 'lobehub');
    expect(screen.getByTestId('codex-icon')).toBeInTheDocument();
    expect(screen.getByTestId('gemini-cli-icon')).toHaveAttribute('data-size', '24');
    expect(screen.getByTestId('openai-color-icon')).toHaveAttribute('data-icon', 'openai');
    expect(screen.getByTestId('openai-color-icon')).toHaveAttribute('data-size', '16');
    expect(screen.getByLabelText('Shell')).toHaveAttribute('data-runtime-brand-source', 'fallback');
    expect(screen.getByLabelText('Shell')).toHaveAttribute('data-runtime-brand-fallback', 'shell');
  });
});
