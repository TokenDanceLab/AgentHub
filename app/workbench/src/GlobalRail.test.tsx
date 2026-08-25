import { fireEvent, render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { GlobalRail } from './GlobalRail';

/* F1/F6 rail attention badge: counts are derived by the frame from the
   run/approval model; the rail only renders + routes the click. Badge copy
   lives in the sharedWorkbench ns — assert against the real en bundle. */

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

function renderRail(props: Partial<Parameters<typeof GlobalRail>[0]> = {}) {
  return render(<GlobalRail userDisplayName="Tester" {...props} />);
}

describe('GlobalRail attention badge (F1/F6)', () => {
  it('shows failed + awaiting on the Tasks entry with the breakdown announced', () => {
    const onNavigate = vi.fn();
    const { container } = renderRail({
      attention: { awaitingApprovalCount: 1, failedRunCount: 2 },
      onNavigate,
    });

    const badge = container.querySelector('[data-rail-attention]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('3');
    // Failed runs are part of the mix -> danger tone (warning otherwise).
    expect(badge?.getAttribute('data-tone')).toBe('danger');

    const tasksButton = container.querySelector('[data-rail-page="runs"]');
    expect(tasksButton).not.toBeNull();
    expect(tasksButton?.getAttribute('aria-label')).toContain('2 failed runs · 1 pending approvals');

    // Click-through still lands on the Tasks queue (existing navigation path).
    fireEvent.click(tasksButton!);
    expect(onNavigate).toHaveBeenCalledWith('runs');
  });

  it('marks scoped (active-conversation) counts in the announced breakdown', () => {
    const { container } = renderRail({
      attention: { awaitingApprovalCount: 2, activeConversationOnly: true },
    });
    const tasksButton = container.querySelector('[data-rail-page="runs"]');
    expect(tasksButton?.getAttribute('aria-label')).toContain('Covers the current conversation only');
    // Approvals only, no failed runs -> warning tone.
    expect(
      container.querySelector('[data-rail-attention]')?.getAttribute('data-tone'),
    ).toBe('warning');
  });

  it('hides the badge when nothing needs action or no counts are provided', () => {
    // Running alone needs no user action -> no rail badge (it surfaces via
    // the status-strip chips / sidebar dots instead).
    const runningOnly = renderRail({
      attention: { runningCount: 4, awaitingApprovalCount: 0, failedRunCount: 0 },
    });
    expect(runningOnly.container.querySelector('[data-rail-attention]')).toBeNull();
    runningOnly.unmount();

    const absent = renderRail({});
    expect(absent.container.querySelector('[data-rail-attention]')).toBeNull();

    // Only the Tasks entry carries the badge, and only for actionable counts.
    const { container } = renderRail({ attention: { runningCount: 1, awaitingApprovalCount: 1 } });
    for (const button of container.querySelectorAll('[data-rail-page]')) {
      const page = button.getAttribute('data-rail-page');
      const badge = button.querySelector('[data-rail-attention]');
      if (page === 'runs') {
        expect(badge?.textContent).toBe('1');
      } else {
        expect(badge).toBeNull();
      }
    }
  });
});
