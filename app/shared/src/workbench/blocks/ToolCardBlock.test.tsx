import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../__tests__/setup';
import { ToolCardBlock } from './ToolCardBlock';

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="claude-code-icon" />,
  Codex: ({ size }: { size?: number }) => <span data-size={size} data-testid="codex-icon" />,
  GeminiCLI: ({ size }: { size?: number }) => <span data-size={size} data-testid="gemini-cli-icon" />,
  ModelIcon: ({ model, size }: { model: string; size?: number }) => <span data-model={model} data-size={size} data-testid="model-icon" />,
  OpenCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="opencode-icon" />,
  ProviderIcon: ({ provider, size }: { provider: string; size?: number }) => <span data-provider={provider} data-size={size} data-testid="provider-icon" />,
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

  it('renders remote replay details and evidence references for tool calls', () => {
    render(
      <ToolCardBlock
        toolName="read_file"
        status="completed"
        path="app/shared/src/workbench/TranscriptView.tsx"
        description="Read 80 lines for transcript replay."
        detailRows={[
          { label: 'Params', value: 'offset=120 limit=80' },
          { label: 'Result', value: '80 lines returned' },
        ]}
        evidenceRefs={[
          {
            id: 'tool-read-file',
            kind: 'tool',
            label: 'tool_call read_file',
            status: 'completed',
          },
          {
            id: 'file-transcript',
            kind: 'file',
            label: 'TranscriptView.tsx',
            path: 'app/shared/src/workbench/TranscriptView.tsx',
          },
        ]}
      />,
    );

    expect(screen.getByText('Params')).toBeInTheDocument();
    expect(screen.getByText('offset=120 limit=80')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText('80 lines returned')).toBeInTheDocument();
    expect(screen.getByText('tool · tool_call read_file · 完成')).toBeInTheDocument();
    expect(screen.getByText('file · TranscriptView.tsx')).toBeInTheDocument();
  });
});
