// Goal banner behavior contract (#1998, UX F8): honest controls and chip
// semantics. The stop entry must exist ONLY when onCancelRun is wired (the
// Hub has no pause channel — never a fake pause button), and the status chip
// must reuse the attention-model palette slots.
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { WorkbenchGoalBanner } from './WorkbenchGoalBanner';
import type { WorkbenchGoalSummary } from './workbenchGoalSummary';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

function summary(overrides: Partial<WorkbenchGoalSummary> = {}): WorkbenchGoalSummary {
  return {
    objective: 'Migrate every endpoint to the typed client',
    status: 'active',
    sourceBlockId: 'tc-goal-1',
    updatedAt: '2026-08-28T02:00:01Z',
    ...overrides,
  };
}

describe('WorkbenchGoalBanner honest controls (#1998)', () => {
  it('renders objective + status chip and zero controls without onCancelRun', () => {
    render(<WorkbenchGoalBanner summary={summary()} />);
    const banner = screen.getByRole('region', { name: 'Conversation goal' });
    expect(banner).toHaveAttribute('data-goal-status', 'active');
    expect(screen.getByText('Migrate every endpoint to the typed client')).toBeInTheDocument();
    expect(screen.getByText('Goal in progress')).toBeInTheDocument();
    // Fail-closed: no stop, no pause — no control surface at all.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a working stop entry when onCancelRun is wired', () => {
    const onCancelRun = vi.fn();
    render(<WorkbenchGoalBanner summary={summary()} onCancelRun={onCancelRun} />);
    const stop = screen.getByRole('button', { name: 'Stop the current run' });
    fireEvent.click(stop);
    expect(onCancelRun).toHaveBeenCalledTimes(1);
  });

  it('maps goal statuses onto the attention chip palette slots', () => {
    const { rerender, container } = render(<WorkbenchGoalBanner summary={summary()} />);
    const chip = () => container.querySelector('[data-attention-kind]');
    expect(chip()).toHaveAttribute('data-attention-kind', 'running');

    rerender(<WorkbenchGoalBanner summary={summary({ status: 'blocked' })} />);
    expect(chip()).toHaveAttribute('data-attention-kind', 'awaiting');
    expect(screen.getByText('Goal blocked')).toBeInTheDocument();

    rerender(<WorkbenchGoalBanner summary={summary({ status: 'completed' })} />);
    expect(chip()).toHaveAttribute('data-attention-kind', 'goal-complete');
    expect(screen.getByText('Goal completed')).toBeInTheDocument();
  });

  it('keeps the stop entry keyboard reachable', () => {
    render(<WorkbenchGoalBanner summary={summary()} onCancelRun={() => {}} />);
    const stop = screen.getByRole('button', { name: 'Stop the current run' });
    stop.focus();
    expect(stop).toHaveFocus();
    fireEvent.keyDown(stop, { key: 'Enter' });
    // Native buttons activate on Enter/Space through click synthesis;
    // focusability is the keyboard-reachability contract here.
    expect(document.activeElement).toBe(stop);
  });
});
