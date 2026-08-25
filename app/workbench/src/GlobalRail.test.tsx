import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GlobalRail } from './GlobalRail';

/* F1/F6 rail attention badge: count is derived by the caller from the
   run/approval model; the rail only renders + routes the click. */

function renderRail(props: Partial<Parameters<typeof GlobalRail>[0]> = {}) {
  return render(<GlobalRail userDisplayName="Tester" {...props} />);
}

describe('GlobalRail attention badge (F1/F6)', () => {
  it('shows the combined count on the Tasks entry with the breakdown announced', () => {
    const onNavigate = vi.fn();
    const { container } = renderRail({
      attention: { runningCount: 2, awaitingApprovalCount: 1 },
      onNavigate,
    });

    const badge = container.querySelector('[data-rail-attention]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('3');

    const tasksButton = container.querySelector('[data-rail-page="runs"]');
    expect(tasksButton).not.toBeNull();
    expect(tasksButton?.getAttribute('aria-label')).toContain('运行中 2 · 待批准 1');

    // Click-through still lands on the Tasks queue (existing navigation path).
    fireEvent.click(tasksButton!);
    expect(onNavigate).toHaveBeenCalledWith('runs');
  });

  it('hides the badge when every count is zero or no inventory is provided', () => {
    const zero = renderRail({ attention: { runningCount: 0, awaitingApprovalCount: 0 } });
    expect(zero.container.querySelector('[data-rail-attention]')).toBeNull();
    zero.unmount();

    const absent = renderRail({});
    expect(absent.container.querySelector('[data-rail-attention]')).toBeNull();

    // Non-Tasks entries never carry the badge even with attention present.
    const { container } = renderRail({ attention: { runningCount: 1, awaitingApprovalCount: 0 } });
    for (const button of container.querySelectorAll('[data-rail-page]')) {
      const page = button.getAttribute('data-rail-page');
      if (page === 'runs') continue;
      expect(button.querySelector('[data-rail-attention]')).toBeNull();
    }
  });
});
