import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingOverlay } from '@/components/OnboardingOverlay';

/* ═══════════════════════════════════════════════════════════════════════
   OnboardingOverlay — first-run guidance (#1819). The desktop test i18n
   echoes default-namespace keys, so assertions match raw key strings.
   ═══════════════════════════════════════════════════════════════════════ */

describe('OnboardingOverlay', () => {
  it('renders the first step with a Next action', () => {
    render(<OnboardingOverlay onFinish={vi.fn()} />);

    expect(screen.getByTestId('onboarding-dialog')).toBeInTheDocument();
    expect(screen.getByText('onboarding.step1.title')).toBeInTheDocument();
    expect(screen.getByText('onboarding.step1.body')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-next')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-done')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-dot-0')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('onboarding-dot-1')).not.toHaveAttribute('aria-current');
  });

  it('advances to the second step and shows the final action', () => {
    render(<OnboardingOverlay onFinish={vi.fn()} />);

    fireEvent.click(screen.getByTestId('onboarding-next'));

    expect(screen.getByText('onboarding.step2.title')).toBeInTheDocument();
    expect(screen.getByText('onboarding.step2.body')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-done')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-next')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-dot-1')).toHaveAttribute('aria-current', 'step');
  });

  it('finishes from the last step', () => {
    const onFinish = vi.fn();
    render(<OnboardingOverlay onFinish={onFinish} />);

    fireEvent.click(screen.getByTestId('onboarding-next'));
    fireEvent.click(screen.getByTestId('onboarding-done'));

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('skips immediately without finishing the steps', () => {
    const onFinish = vi.fn();
    render(<OnboardingOverlay onFinish={onFinish} />);

    fireEvent.click(screen.getByTestId('onboarding-skip'));

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape', () => {
    const onFinish = vi.fn();
    render(<OnboardingOverlay onFinish={onFinish} />);

    fireEvent.keyDown(screen.getByTestId('onboarding-overlay'), { key: 'Escape' });

    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
