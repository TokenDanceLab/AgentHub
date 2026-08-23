import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getI18n } from 'react-i18next';
import zh from '@/i18n/locales/zh.json';
import { OnboardingOverlay } from '@/components/OnboardingOverlay';

/* ═══════════════════════════════════════════════════════════════════════
   OnboardingOverlay — first-run guidance (#1819).

   Asserts against the real zh desktop locale (registered below), not the
   key-echo test fallback, so a missing/regressed localized resource fails
   these tests. Focus behavior covers the shared useFocusTrap wiring
   (initial focus, Tab wrap, trigger restore).
   ═══════════════════════════════════════════════════════════════════════ */

beforeAll(async () => {
  const i18n = getI18n();
  // The shared desktop test instance defaults to the chatview namespace; the
  // overlay reads the desktop default namespace like the production init.
  i18n.addResourceBundle('zh', 'translation', zh, true, true);
  i18n.setDefaultNamespace('translation');
  await i18n.changeLanguage('zh');
});

/** Host with a real trigger element, for focus-restore assertions. */
function ToggleHost() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Open onboarding
      </button>
      {open ? <OnboardingOverlay onFinish={() => setOpen(false)} /> : null}
    </>
  );
}

describe('OnboardingOverlay', () => {
  it('renders the first step with real localized copy and a Next action', () => {
    render(<OnboardingOverlay onFinish={vi.fn()} />);

    expect(screen.getByTestId('onboarding-dialog')).toBeInTheDocument();
    expect(screen.getByText('连接真实数据源')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-next')).toHaveTextContent('下一步');
    expect(screen.queryByTestId('onboarding-done')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-dot-0')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('onboarding-dot-1')).not.toHaveAttribute('aria-current');
  });

  it('advances to the second step and shows the final action', () => {
    render(<OnboardingOverlay onFinish={vi.fn()} />);

    fireEvent.click(screen.getByTestId('onboarding-next'));

    expect(screen.getByText('@ Agent 派单执行')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-done')).toHaveTextContent('开始使用');
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

  it('moves initial focus into the dialog and returns it to the trigger on close', () => {
    render(<ToggleHost />);
    const trigger = screen.getByText('Open onboarding');
    trigger.focus();
    fireEvent.click(trigger);

    // useFocusTrap focuses the first focusable descendant on activation.
    expect(document.activeElement).toBe(screen.getByTestId('onboarding-skip'));

    fireEvent.click(screen.getByTestId('onboarding-skip'));
    expect(screen.queryByTestId('onboarding-dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab focus inside the dialog', () => {
    render(<OnboardingOverlay onFinish={vi.fn()} />);
    const lastFocusable = screen.getByTestId('onboarding-next');

    lastFocusable.focus();
    expect(document.activeElement).toBe(lastFocusable);

    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByTestId('onboarding-skip'));
  });
});
