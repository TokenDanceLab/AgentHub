import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { MainchainStatusStrip } from './MainchainStatusStrip';
import type { MainchainSummary } from './mainchain';

// Chip copy resolves through the real zh/en bundles (sharedWorkbench ns),
// so opt into a real language instead of the key-echo default (#1717).
beforeAll(async () => {
  await useTestI18nLanguage('en');
});

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
    expect(strip).toHaveAttribute('aria-label', 'Demo main chain status');
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

    const runningChip = screen.getByRole('button', { name: '2 running · Open the task queue' });
    const awaitingChip = screen.getByRole('button', { name: '3 awaiting approval · Jump to pending approval' });
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
    expect(screen.queryByRole('button', { name: /running/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 awaiting approval/ })).toBeInTheDocument();
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

  it('labels scoped counts as active-conversation-only instead of global', () => {
    render(
      <MainchainStatusStrip
        summary={summary}
        onExportEvidence={() => {}}
        attention={{ awaitingApprovalCount: 1, activeConversationOnly: true }}
        onOpenApprovalQueue={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: '1 awaiting approval · Jump to pending approval · Covers the current conversation only',
      }),
    ).toBeInTheDocument();
  });
});


describe('MainchainStatusStrip usage chip (#1990, UX F14)', () => {
  it('renders the compact usage total and routes to the usage page on click', () => {
    const onOpenUsage = vi.fn();
    render(
      <MainchainStatusStrip
        summary={summary}
        onExportEvidence={() => {}}
        usageTokenTotal={12400}
        onOpenUsage={onOpenUsage}
      />,
    );
    const chip = screen.getByRole('button', { name: '12.4k tokens used · Open the usage board' });
    expect(chip).toHaveAttribute('data-attention-kind', 'usage');
    fireEvent.click(chip);
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
  });

  it('renders a plain status chip without a handler (demo surfaces stay honest)', () => {
    render(
      <MainchainStatusStrip summary={summary} onExportEvidence={() => {}} usageTokenTotal={42} />,
    );
    expect(screen.getByText('42 tokens used')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tokens used/ })).toBeNull();
  });

  it('hides the chip entirely without a total (no fake 0)', () => {
    const { container } = render(
      <MainchainStatusStrip summary={summary} onExportEvidence={() => {}} />,
    );
    expect(container.querySelector('[data-attention-kind="usage"]')).toBeNull();
  });

  it('coexists with attention chips in the same strip', () => {
    render(
      <MainchainStatusStrip
        summary={summary}
        onExportEvidence={() => {}}
        attention={{ runningCount: 1, awaitingApprovalCount: 0 }}
        usageTokenTotal={900}
      />,
    );
    expect(screen.getByText('900 tokens used')).toBeInTheDocument();
    expect(screen.getByText(/1 running/)).toBeInTheDocument();
  });
});
