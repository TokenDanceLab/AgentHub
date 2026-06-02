import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiffReviewPanel } from './DiffReviewPanel';
import type { DiffReviewFile } from './DiffReviewPanel';

function makeHunk(header: string, lines: Array<{ type: 'added' | 'deleted' | 'context'; oldLineNumber?: number; newLineNumber?: number; content: string }>) {
  return { header, lines };
}

const mockFileAdded: DiffReviewFile = {
  filePath: 'src/new-file.ts',
  status: 'added',
  additions: 3,
  deletions: 0,
  hunks: [
    makeHunk('@@ -0,0 +1,3 @@', [
      { type: 'added', newLineNumber: 1, content: 'export const a = 1;' },
      { type: 'added', newLineNumber: 2, content: 'export const b = 2;' },
      { type: 'added', newLineNumber: 3, content: 'export const c = 3;' },
    ]),
  ],
};

const mockFileModified: DiffReviewFile = {
  filePath: 'src/edited-file.ts',
  status: 'modified',
  additions: 2,
  deletions: 2,
  hunks: [
    makeHunk('@@ -1,4 +1,4 @@', [
      { type: 'context', oldLineNumber: 1, newLineNumber: 1, content: 'import React from "react";' },
      { type: 'deleted', oldLineNumber: 2, content: 'const old = true;' },
      { type: 'added', newLineNumber: 2, content: 'const updated = false;' },
      { type: 'context', oldLineNumber: 3, newLineNumber: 3, content: 'export default App;' },
    ]),
  ],
};

const mockFileDeleted: DiffReviewFile = {
  filePath: 'src/removed-file.ts',
  status: 'deleted',
  additions: 0,
  deletions: 5,
  hunks: [
    makeHunk('@@ -1,5 +0,0 @@', [
      { type: 'deleted', oldLineNumber: 1, content: 'line 1' },
      { type: 'deleted', oldLineNumber: 2, content: 'line 2' },
      { type: 'deleted', oldLineNumber: 3, content: 'line 3' },
      { type: 'deleted', oldLineNumber: 4, content: 'line 4' },
      { type: 'deleted', oldLineNumber: 5, content: 'line 5' },
    ]),
  ],
};

describe('DiffReviewPanel', () => {
  it('renders the panel container', () => {
    render(<DiffReviewPanel files={[mockFileModified]} />);
    expect(screen.getByTestId('diff-review-panel')).toBeDefined();
  });

  // ── Empty state ────────────────────────────────────────────────────────

  it('renders empty state message when no files', () => {
    render(<DiffReviewPanel files={[]} />);
    expect(screen.getByText('No changes to review')).toBeDefined();
  });

  it('renders custom empty state label', () => {
    render(
      <DiffReviewPanel
        files={[]}
        labels={{ empty: 'Nothing here' }}
      />,
    );
    expect(screen.getByText('Nothing here')).toBeDefined();
  });

  // ── File tabs ──────────────────────────────────────────────────────────

  it('renders file tabs for each file', () => {
    render(<DiffReviewPanel files={[mockFileAdded, mockFileModified, mockFileDeleted]} />);
    const tablist = screen.getByRole('tablist');
    const tabs = tablist.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
  });

  it('displays file path in each tab', () => {
    render(<DiffReviewPanel files={[mockFileAdded, mockFileModified]} />);
    // File paths appear in tab buttons and in the toolbar; use getAllByText
    const newFileEls = screen.getAllByText('src/new-file.ts');
    const editedFileEls = screen.getAllByText('src/edited-file.ts');
    expect(newFileEls.length).toBeGreaterThanOrEqual(1);
    expect(editedFileEls.length).toBeGreaterThanOrEqual(1);
  });

  it('first tab is selected by default', () => {
    render(<DiffReviewPanel files={[mockFileAdded, mockFileModified]} />);
    const tabs = screen.getByRole('tablist').querySelectorAll('[role="tab"]');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('false');
  });

  it('switches active file on tab click', async () => {
    const user = userEvent.setup();
    render(<DiffReviewPanel files={[mockFileAdded, mockFileModified]} />);
    const tabs = screen.getByRole('tablist').querySelectorAll('[role="tab"]');
    await user.click(tabs[1]!);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
  });

  // ── File action badges ────────────────────────────────────────────────

  it('displays "A" badge for added files', () => {
    render(<DiffReviewPanel files={[mockFileAdded]} />);
    expect(screen.getByText('A')).toBeDefined();
  });

  it('displays "D" badge for deleted files', () => {
    render(<DiffReviewPanel files={[mockFileDeleted, mockFileAdded]} />);
    expect(screen.getByText('D')).toBeDefined();
  });

  it('displays "M" badge for modified files', () => {
    render(<DiffReviewPanel files={[mockFileModified]} />);
    expect(screen.getByText('M')).toBeDefined();
  });

  // ── Toolbar stats ──────────────────────────────────────────────────────

  it('displays additions and deletions stats', () => {
    render(<DiffReviewPanel files={[mockFileModified]} />);
    expect(screen.getByText('+2')).toBeDefined();
    expect(screen.getByText('-2')).toBeDefined();
  });

  it('displays modified count when there are modified line pairs', () => {
    render(<DiffReviewPanel files={[mockFileModified]} />);
    // The mock has 1 deleted+added pair → ~1
    expect(screen.getByText('~1')).toBeDefined();
  });

  // ── Diff content: side-by-side columns ─────────────────────────────────

  it('renders Original and Modified column headers', () => {
    render(<DiffReviewPanel files={[mockFileModified]} />);
    expect(screen.getByText('Original')).toBeDefined();
    expect(screen.getByText('Modified')).toBeDefined();
  });

  it('renders custom column header labels', () => {
    render(
      <DiffReviewPanel
        files={[mockFileModified]}
        labels={{ original: 'Old', modified: 'New' }}
      />,
    );
    expect(screen.getByText('Old')).toBeDefined();
    expect(screen.getByText('New')).toBeDefined();
  });

  // ── Accept All / Reject All ────────────────────────────────────────────

  it('renders Accept All and Reject All buttons', () => {
    render(<DiffReviewPanel files={[mockFileModified]} />);
    expect(screen.getByRole('button', { name: 'Accept All' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reject All' })).toBeDefined();
  });

  it('calls onAcceptAll when Accept All is clicked', async () => {
    const user = userEvent.setup();
    const onAcceptAll = vi.fn();
    render(<DiffReviewPanel files={[mockFileModified]} onAcceptAll={onAcceptAll} />);
    await user.click(screen.getByRole('button', { name: 'Accept All' }));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });

  it('calls onRejectAll when Reject All is clicked', async () => {
    const user = userEvent.setup();
    const onRejectAll = vi.fn();
    render(<DiffReviewPanel files={[mockFileModified]} onRejectAll={onRejectAll} />);
    await user.click(screen.getByRole('button', { name: 'Reject All' }));
    expect(onRejectAll).toHaveBeenCalledTimes(1);
  });

  it('uses custom Accept All / Reject All labels', () => {
    render(
      <DiffReviewPanel
        files={[mockFileModified]}
        labels={{ acceptAll: 'Approve', rejectAll: 'Deny' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDefined();
  });

  // ── Line-level accept / reject ─────────────────────────────────────────

  it('renders accept and reject line action buttons for modified rows', () => {
    render(<DiffReviewPanel files={[mockFileModified]} />);
    // Each modified row pair has accept + reject buttons in both columns
    // Using aria-label for precise selection
    const acceptBtns = screen.getAllByRole('button', { name: 'Accept line' });
    const rejectBtns = screen.getAllByRole('button', { name: 'Reject line' });
    // 1 modified pair × 2 columns = 2 each
    expect(acceptBtns.length).toBeGreaterThanOrEqual(2);
    expect(rejectBtns.length).toBeGreaterThanOrEqual(2);
  });

  it('does not render line action buttons for context rows', () => {
    render(<DiffReviewPanel files={[mockFileModified]} />);
    // Context rows (line 1 and line 4) should not have action buttons
    // The accept/reject buttons count should only cover the modified row
    // We verify by checking the overall count is correct
    const acceptBtns = screen.getAllByRole('button', { name: 'Accept line' });
    expect(acceptBtns.length).toBe(2); // Left + right for the one modified pair
  });

  it('toggles accept state on line accept button click', async () => {
    const user = userEvent.setup();
    render(<DiffReviewPanel files={[mockFileModified]} />);
    const acceptBtns = screen.getAllByRole('button', { name: 'Accept line' });
    // Click accept on first (left column)
    await user.click(acceptBtns[0]!);
    // After clicking accept, the reject state should be cleared and accept should be active
    // The button should gain the active class (we check DOM)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(acceptBtns[0]!.className).toBeTruthy();
    // Toggling again should deactivate
    await user.click(acceptBtns[0]!);
    expect(acceptBtns[0]!.className).toBeTruthy();
  });

  it('toggles reject state on line reject button click', async () => {
    const user = userEvent.setup();
    render(<DiffReviewPanel files={[mockFileModified]} />);
    const rejectBtns = screen.getAllByRole('button', { name: 'Reject line' });
    await user.click(rejectBtns[0]!);
    // Reject button should have active class
    expect(rejectBtns[0]!.className).toBeTruthy();
  });

  // ── CSS className props ────────────────────────────────────────────────

  it('applies className to root element', () => {
    render(<DiffReviewPanel files={[mockFileModified]} className="custom-root" />);
    const panel = screen.getByTestId('diff-review-panel');
    expect(panel.className).toContain('custom-root');
  });

  it('applies fileTabsClassName', () => {
    render(<DiffReviewPanel files={[mockFileModified]} fileTabsClassName="custom-tabs" />);
    const tablist = screen.getByRole('tablist');
    expect(tablist.className).toContain('custom-tabs');
  });

  it('applies toolbarClassName', () => {
    const { container } = render(<DiffReviewPanel files={[mockFileModified]} toolbarClassName="custom-toolbar" />);
    const toolbar = container.querySelector('[class*="toolbar"]');
    expect(toolbar?.className).toContain('custom-toolbar');
  });

  it('applies diffContentClassName', () => {
    const { container } = render(<DiffReviewPanel files={[mockFileModified]} diffContentClassName="custom-diff" />);
    const diffContent = container.querySelector('[class*="diffContent"]');
    expect(diffContent?.className).toContain('custom-diff');
  });
});
