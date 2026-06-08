import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ComposerState } from '../composer';
import { UnifiedComposer } from './UnifiedComposer';

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: () => null,
  Codex: () => null,
  GeminiCLI: () => null,
  ModelIcon: () => null,
  OpenCode: () => null,
  ProviderIcon: () => null,
}));
vi.mock('@lobehub/icons/es/Antigravity/components/Color.js', () => ({ default: () => null }));

const mentionedComposer: ComposerState = {
  conversationId: 'hub-session-1',
  text: 'Run the real task',
  mode: 'code',
  mentions: [{ id: 'profile-builder', label: 'Builder', runtimeId: 'claude-code' }],
  attachments: [],
  approvalMode: 'suggest',
  workDir: '',
  submitState: 'idle',
};

describe('UnifiedComposer execution target selection', () => {
  it('locks mentioned real dispatch until a Desktop/Edge target is selected', () => {
    render(
      <UnifiedComposer
        composer={mentionedComposer}
        dispatchComposer={vi.fn()}
        executionTargets={[]}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Desktop/Edge target')).toBeDisabled();
    expect(screen.getByText('No online Desktop/Edge target is available.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
  });

  it('does not submit with Enter when a mentioned agent has no selected target', () => {
    const handleSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());

    render(
      <UnifiedComposer
        composer={mentionedComposer}
        dispatchComposer={vi.fn()}
        executionTargets={[{ id: 'target-local-edge-1', label: 'Desktop Edge' }]}
        onSubmit={handleSubmit}
      />,
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Composer input' }), { key: 'Enter' });

    expect(screen.getByText('Select a Desktop/Edge target before starting.')).toBeInTheDocument();
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
