import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AlertCircle } from 'lucide-react';
import { MobileRecoveryPanel } from '../components/MobileRecoveryPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.actions.retry': 'Retry',
        'common.actions.retrying': 'Retrying',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@agenthub/shared/ui', () => ({
  RecoveryPanel: ({
    title,
    description,
    primaryAction,
    secondaryAction,
    icon,
    eyebrow,
    meta,
    ...rest
  }: Record<string, unknown>) => (
    <div data-testid="recovery-panel" {...rest}>
      {icon as React.ReactNode}
      <span data-testid="eyebrow">{eyebrow as string}</span>
      <h2>{title as string}</h2>
      <p data-testid="description">{description as string}</p>
      {meta != null && <span data-testid="meta">{meta as string}</span>}
      <button
        data-testid="retry-btn"
        disabled={(primaryAction as Record<string, boolean>)?.busy}
        onClick={() => (primaryAction as Record<string, () => void>)?.onClick?.()}
      >
        {(primaryAction as Record<string, boolean>)?.busy
          ? (primaryAction as Record<string, string>)?.busyLabel
          : (primaryAction as Record<string, string>)?.label}
      </button>
      {(secondaryAction as Record<string, unknown> | null) && (
        <button
          data-testid="secondary-btn"
          onClick={() => (secondaryAction as Record<string, () => void>)?.onClick?.()}
        >
          {(secondaryAction as Record<string, string>)?.label}
        </button>
      )}
    </div>
  ),
}));

describe('MobileRecoveryPanel', () => {
  const defaultProps = {
    icon: <AlertCircle size={18} data-testid="recovery-icon" />,
    eyebrow: 'Connection lost',
    title: 'Unable to sync',
    description: 'Check your network and try again.',
    isRetrying: false,
    onRetry: vi.fn(),
  };

  it('renders with title, description, and eyebrow', () => {
    render(<MobileRecoveryPanel {...defaultProps} />);
    expect(screen.getByTestId('recovery-panel')).toBeInTheDocument();
    expect(screen.getByText('Unable to sync')).toBeInTheDocument();
    expect(screen.getByTestId('description')).toHaveTextContent('Check your network and try again.');
    expect(screen.getByTestId('eyebrow')).toHaveTextContent('Connection lost');
  });

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<MobileRecoveryPanel {...defaultProps} onRetry={onRetry} />);
    fireEvent.click(screen.getByTestId('retry-btn'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('displays "Retrying" label when isRetrying is true', () => {
    render(<MobileRecoveryPanel {...defaultProps} isRetrying={true} />);
    const btn = screen.getByTestId('retry-btn');
    expect(btn).toHaveTextContent('Retrying');
    expect(btn).toBeDisabled();
  });

  it('renders meta text when provided', () => {
    render(<MobileRecoveryPanel {...defaultProps} meta="Last attempt 14:30" />);
    expect(screen.getByTestId('meta')).toHaveTextContent('Last attempt 14:30');
  });

  it('renders secondary action button when secondaryLabel and onSecondaryAction are provided', () => {
    const onSecondaryAction = vi.fn();
    render(
      <MobileRecoveryPanel
        {...defaultProps}
        secondaryLabel="Go back"
        onSecondaryAction={onSecondaryAction}
      />,
    );
    const secondaryBtn = screen.getByTestId('secondary-btn');
    expect(secondaryBtn).toBeInTheDocument();
    expect(secondaryBtn).toHaveTextContent('Go back');
    fireEvent.click(secondaryBtn);
    expect(onSecondaryAction).toHaveBeenCalledTimes(1);
  });

  it('does not render secondary action when secondaryLabel is not provided', () => {
    render(<MobileRecoveryPanel {...defaultProps} />);
    expect(screen.queryByTestId('secondary-btn')).not.toBeInTheDocument();
  });
});
