import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MainchainStatusStrip } from './MainchainStatusStrip';
import type { MainchainSummary } from './mainchain';

// Key-echo default of the shared test i18next instance keeps the original
// identity-mock visible copy for this a11y suite (Issue #1717).

const summary: MainchainSummary = {
  nodes: [{ id: 'n1', label: 'Agent A', detail: 'done', state: 'done' }],
  exportEnabled: false,
  exportLabel: '导出',
  exportDetail: '',
};

describe('MainchainStatusStrip a11y', () => {
  it('renders a polite live region with the status label', () => {
    const { getByRole } = render(
      <MainchainStatusStrip summary={summary} onExportEvidence={() => {}} />
    );
    const strip = getByRole('region');
    expect(strip).toHaveAttribute('aria-live', 'polite');
    expect(strip).toHaveAttribute('aria-label', 'aria.mainChainStatus');
  });
});

describe('MainchainStatusStrip attention chips (F6)', () => {
  it('renders clickable running/awaiting chips that route to their queues', () => {
    const onOpenRunningQueue = vi.fn();
    const onOpenApprovalQueue = vi.fn();
    render(
      <MainchainStatusStrip
        summary={summary}
        onExportEvidence={() => {}}
        attention={{ runningCount: 2, awaitingApprovalCount: 3 }}
        onOpenRunningQueue={onOpenRunningQueue}
        onOpenApprovalQueue={onOpenApprovalQueue}
      />,
    );

    const runningChip = screen.getByRole('button', { name: '运行中 2，查看任务队列' });
    const awaitingChip = screen.getByRole('button', { name: '待批准 3，查看审批' });
    expect(runningChip).toHaveAttribute('data-attention-kind', 'running');
    expect(awaitingChip).toHaveAttribute('data-attention-kind', 'awaiting');

    fireEvent.click(runningChip);
    expect(onOpenRunningQueue).toHaveBeenCalledTimes(1);
    fireEvent.click(awaitingChip);
    expect(onOpenApprovalQueue).toHaveBeenCalledTimes(1);
  });

  it('renders only chips with non-zero counts', () => {
    render(
      <MainchainStatusStrip
        summary={summary}
        onExportEvidence={() => {}}
        attention={{ runningCount: 0, awaitingApprovalCount: 1 }}
        onOpenApprovalQueue={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /运行中/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /待批准 1/ })).toBeInTheDocument();
  });

  it('keeps counts visible but non-interactive when no click-through is wired', () => {
    const { container } = render(
      <MainchainStatusStrip
        summary={summary}
        onExportEvidence={() => {}}
        attention={{ runningCount: 4, awaitingApprovalCount: 0 }}
      />,
    );
    const chip = container.querySelector('[data-attention-kind="running"]');
    expect(chip).not.toBeNull();
    expect(chip?.tagName.toLowerCase()).toBe('span');
  });

  it('renders no attention chrome without an inventory', () => {
    const { container } = render(
      <MainchainStatusStrip summary={summary} onExportEvidence={() => {}} />,
    );
    expect(container.querySelector('[data-attention]')).toBeNull();
  });
});
