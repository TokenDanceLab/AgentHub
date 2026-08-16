import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ComposerMainchainStrip,
  ComposerMentionChips,
  ComposerQuoteBar,
  ComposerReplyBar,
  ComposerStatusStrip,
} from './ComposerContextParts';

// These assertions use the en chatview literals; opt into the en bundle of
// the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

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
    // The en resource uses a single-brace placeholder ({label}), which real
    // i18next does not interpolate, so the rendered aria-label keeps it.
    fireEvent.click(screen.getByRole('button', { name: 'Remove @{label}' }));
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
    expect(screen.getByText('目标未选')).toBeInTheDocument();
    expect(screen.getByText('需填写内容')).toBeInTheDocument();

    render(<ComposerStatusStrip statusItems={['数据：真实数据']} />);
    expect(screen.getByText('数据：真实数据')).toBeInTheDocument();
  });
});
