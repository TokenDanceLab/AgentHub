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
  exportLabel: 'Export',
  exportDetail: '',
};

describe('global status bar honesty (#1994, UX F5)', () => {
  it('renders nothing when there is no real data to show', () => {
    const { container } = render(<MainchainStatusStrip />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a polite live region with the connection chip', () => {
    render(<MainchainStatusStrip connectionStatus="connected" />);
    const bar = screen.getByRole('region');
    expect(bar).toHaveAttribute('aria-live', 'polite');
    expect(bar).toHaveAttribute('aria-label', 'Demo main chain status');
    expect(screen.getByText('WebSocket Connected')).toBeInTheDocument();
  });

  it('hides the conversation chain unless the frame enables it', () => {
    render(
      <MainchainStatusStrip connectionStatus="connected" summary={summary} onExportEvidence={() => {}} />,
    );
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('shows chain nodes + export with showConversationChain (chat page)', () => {
    render(
      <MainchainStatusStrip showConversationChain summary={summary} onExportEvidence={() => {}} />,
    );
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('Agent A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
});

describe('MainchainStatusStrip attention chips (F6)', () => {
  it('renders clickable running/awaiting chips that route to their queues', () => {
    const onOpenRunningQueue = vi.fn();
    const onOpenApprovalQueue = vi.fn();
    render(
      <MainchainStatusStrip
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
        attention={{ runningCount: 0, awaitingApprovalCount: 1 }}
        onOpenApprovalQueue={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /running/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 awaiting approval/ })).toBeInTheDocument();
  });

  it('renders no attention chrome without an inventory', () => {
    const { container } = render(<MainchainStatusStrip connectionStatus="connected" />);
    expect(container.querySelector('[data-attention]')).toBeNull();
  });

  it('labels scoped counts as active-conversation-only instead of global', () => {
    render(
      <MainchainStatusStrip
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
    render(<MainchainStatusStrip usageTokenTotal={12400} onOpenUsage={onOpenUsage} />);
    const chip = screen.getByRole('button', { name: '12.4k tokens used · Open the usage board' });
    expect(chip).toHaveAttribute('data-attention-kind', 'usage');
    fireEvent.click(chip);
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
  });

  it('renders a plain status chip without a handler (demo surfaces stay honest)', () => {
    render(<MainchainStatusStrip usageTokenTotal={42} />);
    expect(screen.getByText('42 tokens used')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tokens used/ })).toBeNull();
  });

  it('hides the chip entirely without a total (no fake 0)', () => {
    const { container } = render(<MainchainStatusStrip connectionStatus="connected" />);
    expect(container.querySelector('[data-attention-kind="usage"]')).toBeNull();
  });

  it('coexists with attention chips in the same bar', () => {
    render(
      <MainchainStatusStrip
        attention={{ runningCount: 1, awaitingApprovalCount: 0 }}
        usageTokenTotal={900}
      />,
    );
    expect(screen.getByText('900 tokens used')).toBeInTheDocument();
    expect(screen.getByText(/1 running/)).toBeInTheDocument();
  });
});
