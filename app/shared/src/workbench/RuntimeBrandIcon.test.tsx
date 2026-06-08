import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../__tests__/setup';
import {
  RuntimeBrandIcon,
  resolveRuntimeBrandIcon,
} from './RuntimeBrandIcon';

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="claude-code-icon" />,
  Codex: ({ size }: { size?: number }) => <span data-size={size} data-testid="codex-icon" />,
  GeminiCLI: ({ size }: { size?: number }) => <span data-size={size} data-testid="gemini-cli-icon" />,
  ModelIcon: ({ model, size }: { model: string; size?: number }) => <span data-model={model} data-size={size} data-testid="model-icon" />,
  OpenCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="opencode-icon" />,
  ProviderIcon: ({ provider, size }: { provider: string; size?: number }) => <span data-provider={provider} data-size={size} data-testid="provider-icon" />,
}));

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
    expect(resolveRuntimeBrandIcon({ kind: 'provider', name: 'ByteDance Doubao' })).toMatchObject({
      source: 'lobehub',
      value: 'bytedance',
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

  it('falls back to local compact icons for internal runtimes and tools', () => {
    expect(resolveRuntimeBrandIcon({ kind: 'runtime', name: 'Browser Worker' })).toMatchObject({
      source: 'fallback',
      fallback: 'browser',
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
    expect(screen.getByTestId('provider-icon')).toHaveAttribute('data-provider', 'openai');
    expect(screen.getByTestId('provider-icon')).toHaveAttribute('data-size', '16');
    expect(screen.getByLabelText('Shell')).toHaveAttribute('data-runtime-brand-source', 'fallback');
    expect(screen.getByLabelText('Shell')).toHaveAttribute('data-runtime-brand-fallback', 'shell');
  });
});
