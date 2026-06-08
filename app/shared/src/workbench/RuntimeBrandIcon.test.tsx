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
  ModelIcon: ({ model, size }: { model: string; size?: number }) => <span data-model={model} data-size={size} data-testid="model-icon" />,
  OpenCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="opencode-icon" />,
}));

vi.mock('@lobehub/icons/es/features/ProviderIcon/index.js', () => ({
  default: ({ provider, size }: { provider: string; size?: number }) => <span data-provider={provider} data-size={size} data-testid="provider-icon" />,
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
  });

  it('maps known providers and models to LobeHub helper components', () => {
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
  });

  it('falls back to local compact icons for internal runtimes and tools', () => {
    expect(resolveRuntimeBrandIcon({ kind: 'runtime', name: 'Browser Worker' })).toMatchObject({
      source: 'fallback',
      fallback: 'browser',
    });
    expect(resolveRuntimeBrandIcon({ kind: 'tool', name: 'Git Diff' })).toMatchObject({
      source: 'fallback',
      fallback: 'diff',
    });
  });

  it('renders source metadata for tests', () => {
    render(
      <div>
        <RuntimeBrandIcon kind="runtime" name="Codex" />
        <RuntimeBrandIcon kind="tool" name="Shell" />
      </div>,
    );

    expect(screen.getByLabelText('Codex')).toHaveAttribute('data-runtime-brand-source', 'lobehub');
    expect(screen.getByTestId('codex-icon')).toBeInTheDocument();
    expect(screen.getByLabelText('Shell')).toHaveAttribute('data-runtime-brand-source', 'fallback');
    expect(screen.getByLabelText('Shell')).toHaveAttribute('data-runtime-brand-fallback', 'shell');
  });
});
