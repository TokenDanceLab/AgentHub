import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// RowItem assertions use the en chatview literals. Point the shared test
// i18next instance at the en bundle for this suite (Issue #1717).
import { useTestI18nLanguage } from '../../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

import { RowItem } from './RowItem';
import type { RowItem as RowItemType } from '../types';

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) });
afterEach(() => { vi.useRealTimers() });

// ---------------------------------------------------------------------------
// #1819: waiting-approval "requested at" time feedback
// ---------------------------------------------------------------------------
describe('RowItem waiting-approval requested-at meta (#1819)', () => {
  const waitingApproval = (overrides: Partial<RowItemType> = {}): RowItemType => ({
    id: 'approval-waiting-time',
    type: 'approval',
    label: 'approval',
    status: 'waiting',
    collapsible: true,
    apReason: JSON.stringify({ command: 'npm run build', cwd: '/repo' }),
    ...overrides,
  });

  it('renders "Requested at HH:MM" when waitingSince is present', () => {
    const { container } = render(
      <RowItem item={waitingApproval({ waitingSince: '2026-08-23T08:30:00.000Z' })} />,
    );
    const meta = container.querySelector('.ap-waiting-meta');
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toMatch(/Requested at \d{1,2}:\d{2}/);
  });

  it('hides the meta line when waitingSince is absent', () => {
    const { container } = render(<RowItem item={waitingApproval()} />);
    expect(container.querySelector('.ap-waiting-meta')).toBeNull();
  });

  it('hides the meta line when waitingSince is not a valid date', () => {
    const { container } = render(
      <RowItem item={waitingApproval({ waitingSince: 'not-a-date' })} />,
    );
    expect(container.querySelector('.ap-waiting-meta')).toBeNull();
  });

  it('never renders the meta line on decided approval cards', () => {
    const { container } = render(
      <RowItem
        item={{
          id: 'approval-done',
          type: 'approval',
          label: 'approval',
          status: 'ok',
          collapsible: true,
          apReason: 'Write',
          waitingSince: '2026-08-23T08:30:00.000Z',
        }}
      />,
    );
    expect(container.querySelector('.ap-waiting-meta')).toBeNull();
  });
});

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
// #1821: waiting-approval auto-expand + nested callback plumbing
// ---------------------------------------------------------------------------
describe('RowItem approval cards (#1821)', () => {
  const waitingApproval = (overrides: Partial<RowItemType> = {}): RowItemType => ({
    id: 'approval-1',
    type: 'approval',
    label: 'approval',
    status: 'waiting',
    collapsible: true,
    apReason: JSON.stringify({ command: 'rm -rf dist', cwd: '/repo' }),
    ...overrides,
  });

  it('auto-expands a waiting approval card so the A/R actions are visible', () => {
    const { container } = render(<RowItem item={waitingApproval()} />);
    expect(container.querySelector('.row-item')!.className).toContain('open');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('respects a manual collapse of a waiting approval card (no re-expand)', () => {
    const { container, rerender } = render(<RowItem item={waitingApproval()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    rerender(<RowItem item={waitingApproval({ id: 'approval-1' })} />);
    expect(container.querySelector('.row-item')!.className).not.toContain('open');
  });

  it('passes approve/reject/toggle callbacks into nested children', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onToggle = vi.fn();
    const parent: RowItemType = {
      id: 'group-1', type: 'sub', label: 'run_step_group', status: 'ok',
      collapsible: true, open: true,
      children: [waitingApproval({ id: 'child-approval' })],
    };
    render(
      <RowItem item={parent} onApprove={onApprove} onReject={onReject} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith('child-approval');
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onReject).toHaveBeenCalledWith('child-approval');
    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse' })[1]!);
    expect(onToggle).toHaveBeenCalledWith('child-approval');
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
    expect(container.querySelector('.ap-reject')).not.toBeNull();
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
    fireEvent.click(container.querySelector('.ap-reject')!);
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

// ---------------------------------------------------------------------------
// Fable UIUX gap #4: code copy button Copy→Check feedback
// ---------------------------------------------------------------------------
describe('RowItem code copy button (fable UIUX #4)', () => {
  const codeItem = (overrides: Partial<RowItemType> = {}): RowItemType => ({
    id: 'code-1', type: 'tool', label: 'read', status: 'ok',
    collapsible: true, open: true,
    codeLines: ['const a = 1;', 'console.log(a);'],
    ...overrides,
  });

  it('renders the copy button in idle Copy state', () => {
    const { container } = render(<RowItem item={codeItem()} />);
    const btn = container.querySelector('button[aria-label="Copy"]')!;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Copy');
    expect(btn.classList.contains('copied')).toBe(false);
  });

  it('flips to Copied on click via onCopy and back after 1500ms', () => {
    const onCopy = vi.fn();
    const { container } = render(<RowItem item={codeItem()} onCopy={onCopy} />);
    const btn = container.querySelector('button[aria-label="Copy"]')!;
    fireEvent.click(btn);
    // delegates to the app-level handler with the joined lines
    expect(onCopy).toHaveBeenCalledWith('code-1', 'const a = 1;\nconsole.log(a);');
    // Copy→Check feedback
    expect(btn.textContent).toContain('Copied');
    expect(btn.classList.contains('copied')).toBe(true);
    // 1500ms later the flag resets
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(btn.textContent).toContain('Copy');
    expect(btn.classList.contains('copied')).toBe(false);
  });

  it('copies via navigator.clipboard when no onCopy handler is provided', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { container } = render(<RowItem item={codeItem()} />);
    const btn = container.querySelector('button[aria-label="Copy"]')!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeText).toHaveBeenCalledWith('const a = 1;\nconsole.log(a);');
    expect(btn.textContent).toContain('Copied');
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Wave10 a11y: keyboard equivalents — Enter/Space activate, Shift+F10/Menu
// opens context menu, Escape collapses. Mirrors the ConversationSidebar pattern.
// ---------------------------------------------------------------------------
describe('RowItem keyboard equivalents (Wave10 a11y)', () => {
  const toolItem = (overrides: Partial<RowItemType> = {}): RowItemType => ({
    id: 'tool-kbd', type: 'tool', label: 'read', status: 'ok',
    collapsible: true, open: true, content: 'tool body',
    ...overrides,
  });

  it('Enter activates block select with the stable interaction id', () => {
    const onBlockSelect = vi.fn();
    const { container } = render(<RowItem item={toolItem()} onBlockSelect={onBlockSelect} />);
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'Enter' });
    expect(onBlockSelect).toHaveBeenCalledTimes(1);
    expect(onBlockSelect).toHaveBeenCalledWith('tool-kbd', false);
  });

  it('Space activates block select and prevents default scroll', () => {
    const onBlockSelect = vi.fn();
    const { container } = render(<RowItem item={toolItem()} onBlockSelect={onBlockSelect} />);
    const row = container.querySelector('.row-item')!;
    // Use a real KeyboardEvent with a spy so we can assert preventDefault ran
    // (RTL's fireEvent.keyDown return value does not expose defaultPrevented
    // reliably across jsdom versions).
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    fireEvent(row, event);
    expect(onBlockSelect).toHaveBeenCalledTimes(1);
    expect(onBlockSelect).toHaveBeenCalledWith('tool-kbd', false);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('Shift+Enter passes shiftKey through to block select', () => {
    const onBlockSelect = vi.fn();
    const { container } = render(<RowItem item={toolItem()} onBlockSelect={onBlockSelect} />);
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'Enter', shiftKey: true });
    expect(onBlockSelect).toHaveBeenCalledWith('tool-kbd', true);
  });

  it('Shift+F10 opens the context menu with a rect-derived payload', () => {
    const onContextMenu = vi.fn();
    const { container } = render(<RowItem item={toolItem()} onContextMenu={onContextMenu} />);
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'F10', shiftKey: true });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const [blockId, payload] = onContextMenu.mock.calls[0]!;
    expect(blockId).toBe('tool-kbd');
    expect(typeof payload.preventDefault).toBe('function');
    expect(payload.clientX).toBeGreaterThanOrEqual(0);
    expect(payload.clientY).toBeGreaterThanOrEqual(0);
  });

  it('Menu (ContextMenu) key opens the context menu too', () => {
    const onContextMenu = vi.fn();
    const { container } = render(<RowItem item={toolItem()} onContextMenu={onContextMenu} />);
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'ContextMenu' });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('does not throw when Shift+F10 pressed without an onContextMenu handler', () => {
    const { container } = render(<RowItem item={toolItem()} />);
    expect(() => {
      fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'F10', shiftKey: true });
    }).not.toThrow();
  });

  it('Escape collapses an open collapsible row', () => {
    const { container } = render(<RowItem item={toolItem()} />);
    expect(container.querySelector('.row-bd')).not.toBeNull();
    fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'Escape' });
    expect(container.querySelector('.row-bd')).toBeNull();
  });

  it('Escape is a no-op on a non-collapsible row', () => {
    const { container } = render(<RowItem item={toolItem({ collapsible: false, open: false })} />);
    expect(() => {
      fireEvent.keyDown(container.querySelector('.row-item')!, { key: 'Escape' });
    }).not.toThrow();
    expect(container.querySelector('.row-item')).not.toBeNull();
  });

  it('Enter on the row does not double-fire when focus is on the inner header button', () => {
    const onBlockSelect = vi.fn();
    const { container } = render(<RowItem item={toolItem()} onBlockSelect={onBlockSelect} />);
    fireEvent.keyDown(container.querySelector('.row-hd')!, { key: 'Enter' });
    expect(onBlockSelect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #1871: preview card must not leak the preview domain to a third-party
// favicon service (previously Google s2/favicons).
// ---------------------------------------------------------------------------
describe('RowItem preview card privacy (#1871)', () => {
  it('renders a local icon instead of a third-party favicon request', () => {
    const item: RowItemType = {
      id: 'preview-privacy-1',
      type: 'preview',
      label: 'Deploy',
      status: 'ok',
      collapsible: true,
      open: true,
      content: 'preview',
      url: 'https://prod.example.com',
      previewDomain: 'example.com',
      previewTitle: 'Example',
    };
    const { container } = render(<RowItem item={item} />);

    expect(container.querySelector('a.preview-card')).not.toBeNull();
    expect(container.querySelector('img.preview-favicon')).toBeNull();
    expect(container.textContent).not.toContain('google.com/s2/favicons');
    expect(container.querySelector('a.preview-card svg')).not.toBeNull();
  });

  it('renders an unsafe-scheme preview as an inert card (no external link)', () => {
    const item: RowItemType = {
      id: 'preview-privacy-2',
      type: 'preview',
      label: 'Deploy',
      status: 'ok',
      collapsible: true,
      open: true,
      content: 'preview',
      url: 'javascript:alert(1)',
      previewDomain: '',
      previewTitle: 'javascript:alert(1)',
    };
    const { container } = render(<RowItem item={item} />);

    // External-open is scheme-gated (#1871): unsafe schemes must not become
    // a clickable escape from the sandboxed transcript surface.
    expect(container.querySelector('a.preview-card')).toBeNull();
    expect(container.querySelector('div.preview-card.preview-card-blocked')).not.toBeNull();
    expect(container.textContent).toContain('javascript:alert(1)');
  });

  it('renders a safe http(s) preview as an inert card when external open is disabled', () => {
    const item: RowItemType = {
      id: 'preview-capability-gate',
      type: 'preview',
      label: 'Deploy',
      status: 'ok',
      collapsible: true,
      open: true,
      content: 'preview',
      url: 'https://prod.example.com',
      previewDomain: 'example.com',
      previewTitle: 'Example',
    };
    const { container } = render(<RowItem item={item} previewExternalOpenEnabled={false} />);

    // External-open is capability-gated (#1871): a surface without a browser
    // preview (e.g. Web) must render the safe-URL preview as an inert card,
    // never a clickable outbound link.
    expect(container.querySelector('a.preview-card')).toBeNull();
    expect(container.querySelector('div.preview-card.preview-card-blocked')).not.toBeNull();
  });
});
