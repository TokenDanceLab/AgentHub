import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
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
});
