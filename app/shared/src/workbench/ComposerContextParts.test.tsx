import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ComposerMainchainStrip,
  ComposerMentionChips,
  ComposerQuoteBar,
  ComposerReplyBar,
  ComposerStatusStrip,
} from './ComposerContextParts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const resources: Record<string, string> = {
        'action.removeMention': 'Remove @{label}',
        'aria.selectedAgents': 'Selected agents',
        'aria.agentMainChain': '@Agent main chain',
        'aria.cancelReply': 'Cancel reply',
        'aria.cancelQuote': 'Cancel quote',
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

describe('ComposerContextParts', () => {
  it('renders reply bar and cancels reply', () => {
    const onCancel = vi.fn();
    render(
      <ComposerReplyBar
        isSubmitting={false}
        onCancel={onCancel}
        replyTo={{ messageId: 'm1', author: 'Ada', preview: 'hi there' }}
      />,
    );
    expect(screen.getByText('回复至 Ada: hi there')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders quote bar preview', () => {
    render(
      <ComposerQuoteBar
        isSubmitting={false}
        onCancel={vi.fn()}
        quote={{ messageId: 'q1', author: 'Bob', text: 'quoted text body' }}
      />,
    );
    expect(screen.getByText('Bob: quoted text body')).toBeInTheDocument();
  });

  it('renders mention chips and removes one', () => {
    const onRemove = vi.fn();
    render(
      <ComposerMentionChips
        isSubmitting={false}
        mentions={[{ id: 'profile-builder', label: 'Builder' }]}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText('@Builder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove @Builder' }));
    expect(onRemove).toHaveBeenCalledWith('profile-builder');
  });

  it('renders mainchain and status strips', () => {
    render(
      <ComposerMainchainStrip
        mainchainTask="draft required"
        selectedAgentLabel="@Builder"
        selectedTargetLabel={undefined}
        targetSelected={false}
      />,
    );
    expect(screen.getByText('Agent @Builder')).toBeInTheDocument();
    expect(screen.getByText('Target missing')).toBeInTheDocument();
    expect(screen.getByText('Task draft required')).toBeInTheDocument();

    render(<ComposerStatusStrip statusItems={['Data: approved-real']} />);
    expect(screen.getByText('Data: approved-real')).toBeInTheDocument();
  });
});
