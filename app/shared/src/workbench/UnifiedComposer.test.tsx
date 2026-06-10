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
  replyTo: null,
};

describe('UnifiedComposer execution target selection', () => {
  it('adds @Agent mentions from the composer selector', () => {
    const dispatchComposer = vi.fn();

    render(
      <UnifiedComposer
        composer={mentionedComposer}
        dispatchComposer={dispatchComposer}
        mentionableAgents={[
          { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
        ]}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('@Agent'), {
      target: { value: 'profile-reviewer' },
    });

    expect(dispatchComposer).toHaveBeenCalledWith({
      type: 'addMention',
      mention: { id: 'profile-reviewer', label: 'Reviewer', runtimeId: 'codex' },
    });
    expect(screen.getByRole('button', { name: 'Remove @Builder' })).toBeInTheDocument();
  });

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
    expect(screen.getByRole('button', { name: '启动 Agent 任务' })).toBeDisabled();
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

  it('renders data mode, target, replay, and run start status', () => {
    render(
      <UnifiedComposer
        composer={{ ...mentionedComposer, submitState: 'submitting' }}
        dispatchComposer={vi.fn()}
        executionTargetId="target-local-edge-1"
        executionTargets={[{ id: 'target-local-edge-1', label: 'Alpha Desktop' }]}
        onSubmit={vi.fn()}
        status={{
          dataMode: 'approved-real',
          replayLabel: 'Hub replay: 2 runtime events observed',
          targetLabel: 'Alpha Desktop (target-local-edge-1)',
          targetState: 'ready',
        }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Data: approved-real');
    expect(screen.getByRole('status')).toHaveTextContent('Target: ready - Alpha Desktop');
    expect(screen.getByRole('status')).toHaveTextContent('Hub replay: 2 runtime events observed');
    expect(screen.getByRole('status')).toHaveTextContent('Run/task: starting');
  });
});
