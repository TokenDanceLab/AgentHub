import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../__tests__/setup';
import { ToolCardBlock } from './ToolCardBlock';

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="claude-code-icon" />,
  Codex: ({ size }: { size?: number }) => <span data-size={size} data-testid="codex-icon" />,
  ModelIcon: ({ model, size }: { model: string; size?: number }) => <span data-model={model} data-size={size} data-testid="model-icon" />,
  OpenCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="opencode-icon" />,
}));

vi.mock('@lobehub/icons/es/features/ProviderIcon/index.js', () => ({
  default: ({ provider, size }: { provider: string; size?: number }) => <span data-provider={provider} data-size={size} data-testid="provider-icon" />,
}));

describe('ToolCardBlock', () => {
  it('renders default tool icons through the shared runtime brand resolver', () => {
    const { container } = render(
      <ToolCardBlock toolName="apply_patch" status="running" path="src/app.ts" />,
    );

    const icon = container.querySelector('[data-runtime-brand-kind="tool"]');
    expect(icon).toHaveAttribute('data-runtime-brand-fallback', 'write');
    expect(screen.getByText('apply_patch')).toBeInTheDocument();
  });

  it('keeps explicit glyph overrides for migrated prototype callers', () => {
    render(<ToolCardBlock toolName="Shell" status="completed" icon=">" />);

    expect(screen.getByText('>')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Shell' })).not.toBeInTheDocument();
  });
});
