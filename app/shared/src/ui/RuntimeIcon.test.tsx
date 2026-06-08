import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../__tests__/setup';
import {
  RuntimeIcon,
  resolveRuntimeIcon,
} from './RuntimeIcon';

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="claude-code-icon" />,
  Codex: ({ size }: { size?: number }) => <span data-size={size} data-testid="codex-icon" />,
  GeminiCLI: ({ size }: { size?: number }) => <span data-size={size} data-testid="gemini-cli-icon" />,
  ModelIcon: ({ model, size }: { model: string; size?: number }) => <span data-model={model} data-size={size} data-testid="model-icon" />,
  OpenCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="opencode-icon" />,
  ProviderIcon: ({ provider, size }: { provider: string; size?: number }) => <span data-provider={provider} data-size={size} data-testid="provider-icon" />,
}));

describe('RuntimeIcon', () => {
  it('maps known runtimes to named LobeHub runtime icons', () => {
    expect(resolveRuntimeIcon({ kind: 'runtime', name: 'Codex CLI' })).toMatchObject({
      source: 'lobehub',
      value: 'codex',
      lobeType: 'runtime',
    });
    expect(resolveRuntimeIcon({ kind: 'runtime', name: 'Claude Code' })).toMatchObject({
      source: 'lobehub',
      value: 'claude-code',
      lobeType: 'runtime',
    });
    expect(resolveRuntimeIcon({ kind: 'runtime', name: 'Open Code' })).toMatchObject({
      source: 'lobehub',
      value: 'opencode',
      lobeType: 'runtime',
    });
  });

  it('normalizes model and provider names to LobeHub helpers', () => {
    expect(resolveRuntimeIcon({ kind: 'model', name: 'gpt-5-codex' })).toMatchObject({
      source: 'lobehub',
      value: 'gpt-5-codex',
      lobeType: 'model',
    });
    expect(resolveRuntimeIcon({ kind: 'provider', name: 'OpenAI' })).toMatchObject({
      source: 'lobehub',
      value: 'openai',
      lobeType: 'provider',
    });
    expect(resolveRuntimeIcon({ kind: 'model', name: 'internal-fast', provider: 'Anthropic' })).toMatchObject({
      source: 'lobehub',
      value: 'anthropic',
      lobeType: 'provider',
    });
  });

  it('uses deterministic fallback metadata for unknown runtimes and tools', () => {
    expect(resolveRuntimeIcon({ kind: 'runtime', name: 'Browser Worker' })).toMatchObject({
      source: 'fallback',
      fallback: 'browser',
      value: 'BW',
    });
    expect(resolveRuntimeIcon({ kind: 'tool', name: 'apply_patch' })).toMatchObject({
      source: 'fallback',
      fallback: 'write',
      value: 'A',
    });
    expect(resolveRuntimeIcon({ kind: 'tool', name: 'Git Diff' })).toMatchObject({
      source: 'fallback',
      fallback: 'diff',
      value: 'G',
    });
  });

  it('renders accessible labels and LobeHub icon components', () => {
    render(
      <div>
        <RuntimeIcon kind="runtime" name="Codex" />
        <RuntimeIcon kind="runtime" name="Claude Code" size="large" />
        <RuntimeIcon kind="provider" name="OpenAI" size="compact" />
      </div>,
    );

    expect(screen.getByLabelText('Codex')).toHaveAttribute('data-runtime-icon-source', 'lobehub');
    expect(screen.getByTestId('codex-icon')).toBeInTheDocument();
    expect(screen.getByTestId('claude-code-icon')).toHaveAttribute('data-size', '24');
    expect(screen.getByTestId('provider-icon')).toHaveAttribute('data-provider', 'openai');
    expect(screen.getByTestId('provider-icon')).toHaveAttribute('data-size', '16');
  });

  it('supports decorative rendering while keeping title text on labeled icons', () => {
    const { container } = render(
      <div>
        <RuntimeIcon kind="tool" name="Shell" title="Shell tool" />
        <RuntimeIcon kind="runtime" name="Unknown Worker" decorative />
      </div>,
    );

    expect(screen.getByLabelText('Shell tool')).toHaveAttribute('title', 'Shell tool');
    const decorativeIcon = container.querySelector('[data-runtime-icon-value="UW"]');
    expect(decorativeIcon).toHaveAttribute('aria-hidden', 'true');
    expect(decorativeIcon).not.toHaveAttribute('role');
  });
});
