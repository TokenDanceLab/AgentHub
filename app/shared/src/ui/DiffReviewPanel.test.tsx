import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  // ── Hunk-level accept / reject (#1870) ──────────────────────────────

  it('renders accept and reject hunk action buttons for modified rows', () => {
    render(<DiffReviewPanel files={[mockFileModified]} />);
    const acceptBtns = screen.getAllByRole('button', { name: 'Accept hunk' });
    const rejectBtns = screen.getAllByRole('button', { name: 'Reject hunk' });
    // 1 modified pair × 2 columns = 2 each
    expect(acceptBtns.length).toBeGreaterThanOrEqual(2);
    expect(rejectBtns.length).toBeGreaterThanOrEqual(2);
  });

  it('does not render hunk action buttons for context rows', () => {
    render(<DiffReviewPanel files={[mockFileModified]} />);
    const acceptBtns = screen.getAllByRole('button', { name: 'Accept hunk' });
    expect(acceptBtns.length).toBe(2); // Left + right for the one modified pair
  });

  it('accepting a hunk (read-only) marks it applied and disables accept', async () => {
    const user = userEvent.setup();
    render(<DiffReviewPanel files={[mockFileModified]} />);
    const acceptBtns = screen.getAllByRole('button', { name: 'Accept hunk' });
    await user.click(acceptBtns[0]!);
    const acceptBtnAfter = screen.getAllByRole('button', { name: 'Accept hunk' })[0]!;
    expect(acceptBtnAfter.disabled).toBe(true);
    expect(screen.getAllByText('Applied').length).toBeGreaterThan(0);
  });

  it('rejecting a hunk (read-only) marks it rejected and disables reject', async () => {
    const user = userEvent.setup();
    render(<DiffReviewPanel files={[mockFileModified]} />);
    const rejectBtns = screen.getAllByRole('button', { name: 'Reject hunk' });
    await user.click(rejectBtns[0]!);
    const rejectBtnAfter = screen.getAllByRole('button', { name: 'Reject hunk' })[0]!;
    expect(rejectBtnAfter.disabled).toBe(true);
    expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0);
  });

  it('marks hunk applied only after async write-back resolves', async () => {
    const user = userEvent.setup();
    let resolveApply!: () => void;
    const applyHunk = vi.fn(() => new Promise<void>((resolve) => { resolveApply = resolve; }));
    render(
      <DiffReviewPanel
        files={[mockFileModified]}
        runId="run-1"
        onApplyHunk={applyHunk}
      />,
    );
    const acceptBtns = screen.getAllByRole('button', { name: 'Accept hunk' });
    await user.click(acceptBtns[0]!);
    expect(screen.getAllByText('Submitting...').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Applied').length).toBe(0);
    resolveApply();
    await waitFor(() => expect(screen.queryAllByText('Applied').length).toBeGreaterThan(0));
    expect(applyHunk).toHaveBeenCalledWith({ filePath: 'src/edited-file.ts', hunkIndex: 0, accepted: true });
  });

  it('rolls back hunk state when async write-back rejects', async () => {
    const user = userEvent.setup();
    const applyHunk = vi.fn(() => Promise.reject(new Error('boom')));
    render(
      <DiffReviewPanel
        files={[mockFileModified]}
        runId="run-1"
        onApplyHunk={applyHunk}
      />,
    );
    const acceptBtns = screen.getAllByRole('button', { name: 'Accept hunk' });
    await user.click(acceptBtns[0]!);
    await waitFor(() => expect(screen.queryAllByText('Applied').length).toBe(0));
    const acceptBtnAfter = screen.getAllByRole('button', { name: 'Accept hunk' })[0]!;
    expect(acceptBtnAfter.disabled).toBe(false);
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

  // ── Word-diff rendering (P6 Step 4) ─────────────────────────────────
  // modified pair in mockFileModified: 'const old = true;' -> 'const updated = false;'
  // Left column carries removed+context tokens (old, true); right column
  // carries added+context tokens (updated, false). highlightLineWithWordDiff
  // (P6 Step 3) wraps each changed word in a scoped .wordAdded/.wordRemoved
  // span nested inside Prism token spans. The test-env CSS module proxy
  // resolves every key to a scoped name containing the local name as a
  // substring (e.g. _wordAdded_<id>), so [class*="wordAdded"] queries land.
  // NOTE: this asserts span INJECTION, not colour — jsdom css:false cannot
  // render the color-mix() backgrounds or forced-colors HC mapping; those
  // need Windows实机 visual verification (report §8.3, tokens-base.css:586).

  it('renders wordRemoved spans in the left (old) column of a modified row', () => {
    const { container } = render(<DiffReviewPanel files={[mockFileModified]} />);
    const wordRemovedSpans = container.querySelectorAll('[class*="wordRemoved"]');
    expect(wordRemovedSpans.length).toBeGreaterThan(0);
    const texts = Array.from(wordRemovedSpans).map((s) => s.textContent ?? '');
    expect(texts).toContain('old');
    expect(texts).toContain('true');
  });

  it('renders wordAdded spans in the right (new) column of a modified row', () => {
    const { container } = render(<DiffReviewPanel files={[mockFileModified]} />);
    const wordAddedSpans = container.querySelectorAll('[class*="wordAdded"]');
    expect(wordAddedSpans.length).toBeGreaterThan(0);
    const texts = Array.from(wordAddedSpans).map((s) => s.textContent ?? '');
    expect(texts).toContain('updated');
    expect(texts).toContain('false');
  });

  it('does not render word-diff spans on context rows', () => {
    const { container } = render(<DiffReviewPanel files={[mockFileModified]} />);
    const contextRows = container.querySelectorAll('[class*="diffRowContext"]');
    expect(contextRows.length).toBeGreaterThan(0);
    contextRows.forEach((row) => {
      const wordSpans = row.querySelectorAll(
        '[class*="wordAdded"], [class*="wordRemoved"]',
      );
      expect(wordSpans.length).toBe(0);
    });
  });
});
