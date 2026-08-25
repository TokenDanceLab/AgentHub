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
