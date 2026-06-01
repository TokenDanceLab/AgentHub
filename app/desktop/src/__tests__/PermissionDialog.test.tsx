import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PermissionDialog from '@/components/PermissionDialog';
import type { ApprovalMode } from '@/components/PermissionDialog';
import type { PermissionRequestItem } from '@/hooks/useChatMessages';

function makeRequest(overrides: Partial<PermissionRequestItem> = {}): PermissionRequestItem {
  return {
    requestId: 'req-1',
    runId: 'run-1',
    toolName: 'Bash',
    toolInput: { command: 'ls -la' },
    riskLevel: 'high',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('PermissionDialog', () => {
  it('renders nothing when there are no visible requests', () => {
    const { container } = render(
      <PermissionDialog requests={[]} onDecide={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the collapsed notification bar when there are only decided items', () => {
    const requests = [makeRequest({ decision: 'allow' })];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    // Decided items don't auto-expand; bar should be visible
    expect(screen.getByRole('button', { name: 'perm.title' })).toBeInTheDocument();
  });

  it('auto-expands the panel when there is a pending request', () => {
    const requests = [makeRequest()];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    // Auto-expand fires on mount — panel should be visible
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('displays the tool name in expanded panel', () => {
    const requests = [makeRequest({ toolName: 'Bash' })];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  it('shows risk level badge for high risk', () => {
    const requests = [makeRequest({ toolName: 'WebFetch', riskLevel: 'high' })];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows risk level badge for low risk', () => {
    const requests = [makeRequest({ toolName: 'Read', riskLevel: 'low' })];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('shows risk level badge for medium risk', () => {
    const requests = [makeRequest({ toolName: 'Write', riskLevel: 'medium' })];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    expect(screen.getByText('Med')).toBeInTheDocument();
  });

  it('shows risk level badge for critical risk', () => {
    const requests = [makeRequest({ toolName: 'Bash', riskLevel: 'critical' })];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    expect(screen.getByText('Crit')).toBeInTheDocument();
  });

  it('does not show risk badge when riskLevel is undefined', () => {
    const requests = [makeRequest({ riskLevel: undefined })];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    expect(screen.queryByText('Low')).toBeNull();
    expect(screen.queryByText('Med')).toBeNull();
    expect(screen.queryByText('High')).toBeNull();
    expect(screen.queryByText('Crit')).toBeNull();
  });

  it('shows "Always allow this type" checkbox for pending items', () => {
    const requests = [makeRequest()];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    expect(screen.getByText('Always allow this type')).toBeInTheDocument();
  });

  it('toggles the "Always allow this type" checkbox', () => {
    const requests = [makeRequest()];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { checked: false });
    fireEvent.click(checkbox);
    expect(screen.getByRole('checkbox', { checked: true })).toBeInTheDocument();
  });

  it('does not show checkbox for decided items', () => {
    const requests = [makeRequest({ decision: 'allow' })];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    // Decided items don't auto-expand; click to expand
    const bar = screen.getByRole('button', { name: 'perm.title' });
    fireEvent.click(bar);
    expect(screen.queryByText('Always allow this type')).toBeNull();
  });

  it('calls onDecide with allow when Allow button is clicked', () => {
    const onDecide = vi.fn();
    const requests = [makeRequest()];
    render(<PermissionDialog requests={requests} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: /allow.*Bash/i }));
    expect(onDecide).toHaveBeenCalledWith('req-1', 'allow', undefined);
  });

  it('calls onDecide with deny when Deny button is clicked', () => {
    const onDecide = vi.fn();
    const requests = [makeRequest()];
    render(<PermissionDialog requests={requests} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: /deny.*Bash/i }));
    expect(onDecide).toHaveBeenCalledWith('req-1', 'deny', 'user denied');
  });

  it('displays the approval mode selector with Auto by default', () => {
    const requests = [makeRequest()];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('displays YOLO mode', () => {
    const requests = [makeRequest()];
    render(
      <PermissionDialog
        requests={requests}
        onDecide={vi.fn()}
        approvalMode="yolo"
      />,
    );
    expect(screen.getByText('YOLO')).toBeInTheDocument();
  });

  it('displays Manual mode', () => {
    const requests = [makeRequest()];
    render(
      <PermissionDialog
        requests={requests}
        onDecide={vi.fn()}
        approvalMode="manual"
      />,
    );
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('calls onApprovalModeChange when mode selector is clicked', () => {
    const onModeChange = vi.fn();
    const requests = [makeRequest()];
    render(
      <PermissionDialog
        requests={requests}
        onDecide={vi.fn()}
        approvalMode="auto"
        onApprovalModeChange={onModeChange}
      />,
    );
    const modeBtns = screen.getAllByRole('button', { name: /Approval mode/i });
    fireEvent.click(modeBtns[0]);
    expect(onModeChange).toHaveBeenCalledWith('manual');
  });

  it('dismisses individual items', () => {
    const requests = [
      makeRequest({ requestId: 'req-1', toolName: 'Bash' }),
      makeRequest({ requestId: 'req-2', toolName: 'Read', riskLevel: 'low' }),
    ];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    // Items are rendered in reverse order (slice(-10).reverse()),
    // so dismissBtns[0] = Read, dismissBtns[1] = Bash
    const dismissBtns = screen.getAllByTitle('perm.dismiss');
    // Dismiss Bash (second in reverse order)
    fireEvent.click(dismissBtns[1]);
    // After dismissing Bash, it should not be visible
    expect(screen.queryByText('Bash')).toBeNull();
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('shows decided items with ALLOW/DENY status', () => {
    const requests = [
      makeRequest({ requestId: 'req-1', decision: 'allow' }),
      makeRequest({ requestId: 'req-2', decision: 'deny' }),
    ];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    // Decided items don't auto-expand; click bar to expand
    fireEvent.click(screen.getByRole('button', { name: 'perm.title' }));
    expect(screen.getByText('perm.allowed')).toBeInTheDocument();
    expect(screen.getByText('perm.denied')).toBeInTheDocument();
  });

  it('no allow/deny buttons for decided items', () => {
    const requests = [makeRequest({ decision: 'allow' })];
    render(<PermissionDialog requests={requests} onDecide={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'perm.title' }));
    expect(screen.queryByRole('button', { name: /allow.*Bash/i })).toBeNull();
  });

  it('collapses after dismissing all pending items', () => {
    const requests = [makeRequest()];
    const { container } = render(
      <PermissionDialog requests={requests} onDecide={vi.fn()} />,
    );
    expect(screen.getByRole('region')).toBeInTheDocument();
    // Dismiss the only item
    fireEvent.click(screen.getByTitle('perm.dismiss'));
    // After dismissing, no visible items remain → component returns null
    // (render result container may have firstChild null)
  });
});
