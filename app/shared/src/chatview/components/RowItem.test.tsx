import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const resources: Record<string, string> = {
        'card.think.running': 'Thinking...',
        'card.think.done': 'Thinking done',
        'card.think.analyze': 'Analyzing',
        'card.think.analyzeDone': 'Analysis done',
        'card.think.fail': 'Thinking failed',
        'card.think.thoughtFor': 'Thought for {duration}s',
        'card.tool.read': 'Read',
        'card.tool.read.running': 'Reading...',
        'card.tool.grep': 'Search',
        'card.tool.write': 'Write',
        'card.tool.result': 'Tool result',
        'card.tool.generic': '{name}',
        'card.tool.generic.running': 'Running {name}...',
        'card.tool.fail': 'Tool failed',
        'card.file.create': 'Create',
        'card.file.modify': 'Modify',
        'card.file.delete': 'Delete',
        'card.file.fail': 'File failed',
        'card.sub.agent': 'Sub Agent',
        'card.sub.agent.running': 'Agent · {name} working',
        'card.sub.agent.fail': 'Sub Agent failed',
        'card.sub.agent.ok': 'Sub Agent done',
        'card.approval.title': 'Approval',
        'card.approval.waiting': 'Awaiting approval...',
        'card.approval.ok': 'Approval passed',
        'card.approval.fail': 'Approval denied',
        'card.approval.approve': 'Approve',
        'card.approval.deny': 'Deny',
        'card.collapse': 'Collapse',
        'card.expand': 'Expand',
        'card.fail.retry': 'Retry',
        'code.copy': 'Copy',
        'card.deploy.ready': 'Deploy',
        'card.deploy.running': 'Deploying...',
        'card.deploy.fail': 'Deploy failed',
        'card.route.dag': 'Dispatch',
        'card.preview.ready': 'Preview',
        'card.preview.running': 'Preview loading',
        'card.preview.fail': 'Preview failed',
        'card.approval.confirmApprove': 'Confirm approve?',
        'card.approval.risk.low': 'Low risk',
        'card.approval.risk.medium': 'Medium risk',
        'card.approval.risk.high': 'High risk',
        'card.approval.risk.critical': 'Critical risk',
        'card.approval.kbdHint': 'A Approve · R Deny · Esc Collapse',
      };
      let result = resources[key] ?? key;
      if (options) {
        for (const [k, v] of Object.entries(options)) {
          result = result.replace(`{${k}}`, v);
        }
      }
      return result;
    },
  }),
}));

// Must import after the mock
import { RowItem } from './RowItem';
import type { RowItem as RowItemType } from '../types';

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) });
afterEach(() => { vi.useRealTimers() });

// ---------------------------------------------------------------------------
// QW6: Think card Shimmer + duration
// ---------------------------------------------------------------------------
describe('RowItem think card (QW6)', () => {
  it('renders shimmer label when think is running', () => {
    const item: RowItemType = {
      id: 'think-1', type: 'think', label: 'think', status: 'running',
      collapsible: true, content: 'Let me think...',
    };
    const { container } = render(<RowItem item={item} />);
    const shimmer = container.querySelector('.think-shimmer');
    expect(shimmer).not.toBeNull();
    expect(shimmer!.textContent).toContain('Thinking...');
  });

  it('shows duration after think completes', async () => {
    const item: RowItemType = {
      id: 'think-2', type: 'think', label: 'think', status: 'running',
      collapsible: true, content: 'Thought content',
    };
    const { container, rerender } = render(<RowItem item={item} />);
    // Advance time while running
    vi.advanceTimersByTime(3000);
    // Transition to done
    const doneItem: RowItemType = { ...item, status: 'ok' };
    rerender(<RowItem item={doneItem} />);
    // Should show duration ~3s
    await waitFor(() => {
      const dur = container.querySelector('.think-duration');
      expect(dur).not.toBeNull();
      expect(dur!.textContent).toMatch(/Thought for \d+s/);
    });
  });

  it('does not show shimmer when think is not running', () => {
    const item: RowItemType = {
      id: 'think-3', type: 'think', label: 'think', status: 'ok',
      collapsible: true, content: 'Done thinking.',
    };
    const { container } = render(<RowItem item={item} />);
    expect(container.querySelector('.think-shimmer')).toBeNull();
  });

  it('does not show duration without a prior running phase', () => {
    const item: RowItemType = {
      id: 'think-4', type: 'think', label: 'think', status: 'ok',
      collapsible: true, content: 'Pre-existing done card.',
    };
    const { container } = render(<RowItem item={item} />);
    expect(container.querySelector('.think-duration')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// QW4: Approval card six-type rendering
// ---------------------------------------------------------------------------
describe('RowItem approval card (QW4)', () => {
  // ── command + cwd kind ──────────────────────────────────────────
  it('renders command + cwd for command kind approval', () => {
    const item: RowItemType = {
      id: 'ap-cmd', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true, apReason: JSON.stringify({ command: 'npm install', cwd: '/app' }),
    };
    const { container } = render(<RowItem item={item} />);
    const cmd = container.querySelector('.ap-cmd');
    expect(cmd).not.toBeNull();
    expect(cmd!.textContent).toContain('npm install');
    expect(cmd!.textContent).toContain('/app');
  });

  it('uses explicit apKind command', () => {
    const item: RowItemType = {
      id: 'ap-cmd2', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true, apReason: 'npm install', apKind: 'command',
    };
    const { container } = render(<RowItem item={item} />);
    expect(container.querySelector('.ap-cmd')).not.toBeNull();
  });

  // ── diff kind ──────────────────────────────────────────────────
  it('renders diff for diff kind approval', () => {
    const item: RowItemType = {
      id: 'ap-diff', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true,
      apReason: JSON.stringify({ diff: '+added line\n-removed line\n unchanged' }),
    };
    const { container } = render(<RowItem item={item} />);
    const codeLines = container.querySelectorAll('.code-line');
    expect(codeLines.length).toBeGreaterThanOrEqual(3);
    expect(codeLines[0].classList.contains('add')).toBe(true);
    expect(codeLines[1].classList.contains('del')).toBe(true);
  });

  // ── plan kind ──────────────────────────────────────────────────
  it('renders plan kind with markdown', () => {
    const item: RowItemType = {
      id: 'ap-plan', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true,
      apReason: JSON.stringify({ plan: '## Plan\n1. Do X\n2. Do Y' }),
    };
    const { container } = render(<RowItem item={item} />);
    expect(container.querySelector('.ap-plan')).not.toBeNull();
  });

  it('renders plan entries as pills', () => {
    const item: RowItemType = {
      id: 'ap-plan-entries', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true,
      apReason: JSON.stringify({
        plan_entries: [
          { text: 'Step 1', status: 'done' },
          { text: 'Step 2', status: 'pending' },
        ],
      }),
    };
    const { container } = render(<RowItem item={item} />);
    const pills = container.querySelectorAll('.ap-pill');
    expect(pills.length).toBe(2);
    expect(pills[0].textContent).toContain('Step 1');
    expect(pills[0].textContent).toContain('done');
  });

  // ── allowed_prompts kind ───────────────────────────────────────
  it('renders allowed_prompts as tool badge pills', () => {
    const item: RowItemType = {
      id: 'ap-allowed', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true,
      apReason: JSON.stringify({
        allowed_prompts: [
          { tool: 'read', prompt: 'Read config files' },
          { tool: 'grep', prompt: 'Search for patterns' },
        ],
      }),
    };
    const { container } = render(<RowItem item={item} />);
    const pills = container.querySelectorAll('.ap-pill');
    expect(pills.length).toBe(2);
    expect(pills[0].querySelector('.ap-pill-tool')!.textContent).toBe('read');
    expect(pills[0].textContent).toContain('Read config files');
  });

  // ── web kind ───────────────────────────────────────────────────
  it('renders web URL as clickable link', () => {
    const item: RowItemType = {
      id: 'ap-web', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true,
      apReason: JSON.stringify({ url: 'https://example.com/api' }),
    };
    const { container } = render(<RowItem item={item} />);
    const link = container.querySelector('.ap-web a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('https://example.com/api');
    expect(link!.textContent).toBe('https://example.com/api');
  });

  // ── JSON fallback kind ────────────────────────────────────────
  it('renders fallback JSON as pre-formatted text', () => {
    const item: RowItemType = {
      id: 'ap-json', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true,
      apReason: JSON.stringify({ unknownField: 'value', nested: { a: 1 } }),
    };
    const { container } = render(<RowItem item={item} />);
    const jsonBlock = container.querySelector('.ap-json');
    expect(jsonBlock).not.toBeNull();
    expect(jsonBlock!.textContent).toContain('unknownField');
    expect(jsonBlock!.textContent).toContain('nested');
  });

  // ── Plain text fallback ───────────────────────────────────────
  it('renders plain text apReason as content text', () => {
    const item: RowItemType = {
      id: 'ap-text', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true, apReason: 'Please approve this action.',
    };
    const { container } = render(<RowItem item={item} />);
    const jsonBlock = container.querySelector('.ap-json');
    expect(jsonBlock).not.toBeNull();
    expect(jsonBlock!.textContent).toContain('Please approve this action.');
  });

  // ── Approval actions (retained from original) ─────────────────
  it('shows approve/deny buttons when status is waiting', () => {
    const item: RowItemType = {
      id: 'ap-actions', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true, apReason: 'test',
    };
    const { container } = render(<RowItem item={item} />);
    expect(container.querySelector('.ap-approve')).not.toBeNull();
    expect(container.querySelector('.ap-deny')).not.toBeNull();
  });

  it('fires onApprove callback', () => {
    const onApprove = vi.fn();
    const item: RowItemType = {
      id: 'ap-cb', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true, apReason: 'test',
    };
    const { container } = render(<RowItem item={item} onApprove={onApprove} />);
    fireEvent.click(container.querySelector('.ap-approve')!);
    expect(onApprove).toHaveBeenCalledWith('ap-cb');
  });

  it('fires onReject callback', () => {
    const onReject = vi.fn();
    const item: RowItemType = {
      id: 'ap-reject', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true, apReason: 'test',
    };
    const { container } = render(<RowItem item={item} onReject={onReject} />);
    fireEvent.click(container.querySelector('.ap-deny')!);
    expect(onReject).toHaveBeenCalledWith('ap-reject');
  });

  // ── Scroll container ───────────────────────────────────────────
  it('wraps structured content in scroll container', () => {
    const item: RowItemType = {
      id: 'ap-scroll', type: 'approval', label: 'approval', status: 'waiting',
      collapsible: true, open: true, apReason: JSON.stringify({ command: 'echo hello' }),
    };
    const { container } = render(<RowItem item={item} />);
    expect(container.querySelector('.ap-scroll')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T16: keyboard shortcuts (A/R/Esc) + critical second-confirm + risk badge
// ---------------------------------------------------------------------------
describe('RowItem approval card (T16)', () => {
  const baseWaiting = (overrides: Partial<RowItemType> = {}): RowItemType => ({
    id: 'ap-t16', type: 'approval', label: 'approval', status: 'waiting',
    collapsible: true, open: true, apReason: 'test',
    ...overrides,
  });

  // ── Risk badge ───────────────────────────────────────────────
  it('renders RiskBadge when riskLevel is present', () => {
    const { container } = render(<RowItem item={baseWaiting({ riskLevel: 'high' })} />);
    // RiskBadge uses CSS-module hashed classes; we pass a stable global
    // `ap-risk-badge` class from RowItem so it's queryable here.
    const badge = container.querySelector('.ap-actions .ap-risk-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('High risk');
  });

  it('does not render a badge when riskLevel is absent', () => {
    const { container } = render(<RowItem item={baseWaiting()} />);
    expect(container.querySelector('.ap-risk-badge')).toBeNull();
  });

  // ── Keyboard: A / R / Esc (non-critical) ─────────────────────
  it('A key approves on non-critical approval', () => {
    const onApprove = vi.fn();
    const { container } = render(<RowItem item={baseWaiting()} onApprove={onApprove} />);
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'a' });
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith('ap-t16');
  });

  it('uppercase A approves too (case-insensitive)', () => {
    const onApprove = vi.fn();
    const { container } = render(<RowItem item={baseWaiting()} onApprove={onApprove} />);
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'A' });
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('R key denies', () => {
    const onReject = vi.fn();
    const { container } = render(<RowItem item={baseWaiting()} onReject={onReject} />);
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'r' });
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith('ap-t16');
  });

  it('Escape collapses the approval card', () => {
    const { container } = render(<RowItem item={baseWaiting()} />);
    // row-bd present while open
    expect(container.querySelector('.row-bd')).not.toBeNull();
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'Escape' });
    expect(container.querySelector('.row-bd')).toBeNull();
  });

  it('modifier combos are ignored (Ctrl+R does not deny)', () => {
    const onReject = vi.fn();
    const { container } = render(<RowItem item={baseWaiting()} onReject={onReject} />);
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'r', ctrlKey: true });
    expect(onReject).not.toHaveBeenCalled();
  });

  it('ignores keys when status is not waiting', () => {
    const onApprove = vi.fn();
    const { container } = render(
      <RowItem item={baseWaiting({ status: 'ok' })} onApprove={onApprove} />,
    );
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'a' });
    expect(onApprove).not.toHaveBeenCalled();
  });

  // ── critical second-confirm (mouse) ──────────────────────────
  it('critical: first click arms confirm, second click fires approve', () => {
    const onApprove = vi.fn();
    const { container } = render(
      <RowItem item={baseWaiting({ riskLevel: 'critical' })} onApprove={onApprove} />,
    );
    const approveBtn = container.querySelector('.ap-approve')!;
    // critical approve button is red
    expect(approveBtn.classList.contains('critical')).toBe(true);
    // first click arms — no approve fired, button flips to confirm text
    fireEvent.click(approveBtn);
    expect(onApprove).not.toHaveBeenCalled();
    expect(approveBtn.classList.contains('confirming')).toBe(true);
    expect(approveBtn.textContent).toContain('Confirm approve?');
    // second click fires
    fireEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith('ap-t16');
  });

  // ── critical second-confirm (keyboard) ───────────────────────
  it('critical: A key arms, second A fires approve', () => {
    const onApprove = vi.fn();
    const { container } = render(
      <RowItem item={baseWaiting({ riskLevel: 'critical' })} onApprove={onApprove} />,
    );
    const root = container.querySelector('.row-item')!;
    fireEvent.keyDown(root, { key: 'a' });
    expect(onApprove).not.toHaveBeenCalled();
    expect(container.querySelector('.ap-approve')!.classList.contains('confirming')).toBe(true);
    fireEvent.keyDown(root, { key: 'a' });
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('critical: R cancels confirm state and denies', () => {
    const onReject = vi.fn();
    const { container } = render(
      <RowItem item={baseWaiting({ riskLevel: 'critical' })} onReject={onReject} />,
    );
    // arm confirm
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'a' });
    expect(container.querySelector('.ap-approve')!.classList.contains('confirming')).toBe(true);
    // R cancels + denies
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'r' });
    expect(container.querySelector('.ap-approve')!.classList.contains('confirming')).toBe(false);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  // ── non-critical single click ────────────────────────────────
  it('non-critical: single click fires approve immediately', () => {
    const onApprove = vi.fn();
    const { container } = render(
      <RowItem item={baseWaiting({ riskLevel: 'medium' })} onApprove={onApprove} />,
    );
    const btn = container.querySelector('.ap-approve')!;
    // medium risk approve button stays green (not critical)
    expect(btn.classList.contains('critical')).toBe(false);
    fireEvent.click(btn);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith('ap-t16');
  });

  // ── keyboard hint rendered ───────────────────────────────────
  it('renders keyboard hint text', () => {
    const { container } = render(<RowItem item={baseWaiting()} />);
    const hint = container.querySelector('.ap-kbd-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('A');
    expect(hint!.textContent).toContain('R');
  });
});
