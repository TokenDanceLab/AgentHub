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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const resources: Record<string, string> = {
        'action.removeMention': 'Remove @{label}',
        'action.startAgentTask': 'Start agent task',
        'action.stopRun': 'Stop',
        'action.removeAttachment': 'Remove {name}',
        'aria.composerInput': 'Composer input',
        'aria.atAgent': '@Agent',
        'aria.target': 'Desktop/Edge target',
        'aria.attachments': 'Attachments',
        'aria.selectedAgents': 'Selected agents',
        'aria.agentMainChain': '@Agent main chain',
        'aria.cancelReply': 'Cancel reply',
        'aria.cancelQuote': 'Cancel quote',
        'aria.cancelEdit': 'Cancel edit',
        'aria.stopRun': 'Stop run',
        'aria.addAttachment': 'Add attachment',
        'profile.sendMessage': 'Send message',
        'composer.editingMessage': 'Editing message',
      };
      let result = resources[key] ?? key;
      if (options) {
        for (const [k, v] of Object.entries(options)) {
          result = result.replace(`{${k}}`, v);
        }
      }
      return result;
    },
  }),
}));

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
  quote: null,
  editingMessageId: null,
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
    expect(screen.getByText('当前无在线执行目标。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start agent task' })).toBeDisabled();
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

    expect(screen.getByText('请先选择执行目标再开始。')).toBeInTheDocument();
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

    expect(screen.getByRole('status')).toHaveTextContent('数据：真实数据');
    expect(screen.getByRole('status')).toHaveTextContent('目标：就绪 · Alpha Desktop');
    expect(screen.getByRole('status')).toHaveTextContent('Hub replay: 2 runtime events observed');
  });

  it('morphs the send button into a stop button while an agent run is active', () => {
    const onCancel = vi.fn();
    render(
      <UnifiedComposer
        composer={mentionedComposer}
        dispatchComposer={vi.fn()}
        onSubmit={vi.fn()}
        isRunning
        onCancel={onCancel}
      />,
    );

    const stopButton = screen.getByRole('button', { name: 'Stop' });
    expect(stopButton).toHaveAttribute('type', 'button');
    expect(stopButton).toHaveAttribute('data-running', 'true');
    // The submit send button is replaced while running.
    expect(screen.queryByRole('button', { name: 'Start agent task' })).toBeNull();
    fireEvent.click(stopButton);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows an edit bar while editing a sent message and cancels on click', () => {
    const dispatchComposer = vi.fn();
    render(
      <UnifiedComposer
        composer={{ ...mentionedComposer, editingMessageId: 'hub-message-42' }}
        dispatchComposer={dispatchComposer}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText('Editing message')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    expect(dispatchComposer).toHaveBeenCalledWith({ type: 'setEditingMessage', messageId: null });
  });
});
