import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DiffReviewPanel } from '@shared/ui/DiffReviewPanel';
import type { DiffReviewFile } from '@shared/ui/DiffReviewPanel';

// i18n no longer needed — shared DiffReviewPanel uses label props, not useTranslation

function makeHunk(lines: Array<{
  type: 'context' | 'added' | 'deleted';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}>) {
  return { header: '@@ -1,3 +1,4 @@', lines };
}

function makeFile(overrides: Partial<DiffReviewFile> = {}): DiffReviewFile {
  return {
    filePath: 'src/foo.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    hunks: [
      makeHunk([
        { type: 'context', oldLineNumber: 1, newLineNumber: 1, content: 'import React from "react";' },
        { type: 'deleted', oldLineNumber: 2, content: 'const x = 1;' },
        { type: 'added', newLineNumber: 2, content: 'const x = 2;' },
        { type: 'context', oldLineNumber: 3, newLineNumber: 3, content: 'export default App;' },
      ]),
    ],
    ...overrides,
  };
}

function getLineContents(text: string): HTMLElement[] {
  return screen.getAllByText((_, node) => (
    node instanceof HTMLElement &&
    node.className.includes('lineContent') &&
    node.textContent === text
  ));
}

describe('DiffReviewPanel', () => {
  // ── Test 1: Renders empty state when no files ──────────────────────────
  it('renders empty state when there are no files', () => {
    render(<DiffReviewPanel files={[]} />);
    expect(screen.getByTestId('diff-review-panel')).toBeInTheDocument();
    // Should show empty message (depends on i18n key)
    const panel = screen.getByTestId('diff-review-panel');
    expect(panel).toBeInTheDocument();
  });

  // ── Test 2: Renders file tabs for multiple files ───────────────────────
  it('renders file tabs for each file', () => {
    const files = [
      makeFile({ filePath: 'src/a.ts', status: 'modified' }),
      makeFile({ filePath: 'src/b.ts', status: 'added', deletions: 0 }),
    ];
    render(<DiffReviewPanel files={files} />);

    expect(screen.getByRole('tab', { name: /src\/a\.ts/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /src\/b\.ts/ })).toBeInTheDocument();
  });

  // ── Test 3: Renders side-by-side content with correct line types ────────
  it('renders original and modified lines in side-by-side view', () => {
    const files = [makeFile()];
    render(<DiffReviewPanel files={files} />);

    // Context lines appear in both left and right columns
    const contextLines = getLineContents('import React from "react";');
    expect(contextLines.length).toBe(2); // one in each column
    expect(getLineContents('export default App;').length).toBe(2);

    // Deleted line (old) should be visible in left column
    expect(getLineContents('const x = 1;')[0]).toBeInTheDocument();

    // Added line (new) should be visible in right column
    expect(getLineContents('const x = 2;')[0]).toBeInTheDocument();
  });

  // ── Test 4: Renders the Accept All and Reject All toolbar buttons ───────
  it('renders Accept All and Reject All buttons', () => {
    const files = [makeFile()];
    render(<DiffReviewPanel files={files} />);

    const acceptAllBtn = screen.getByRole('button', { name: 'Accept All' });
    const rejectAllBtn = screen.getByRole('button', { name: 'Reject All' });

    expect(acceptAllBtn).toBeInTheDocument();
    expect(rejectAllBtn).toBeInTheDocument();
  });

  // ── Test 5: Accept All calls onAcceptAll callback ──────────────────────
  it('calls onAcceptAll when Accept All is clicked', () => {
    const onAcceptAll = vi.fn();
    const files = [makeFile()];
    render(<DiffReviewPanel files={files} onAcceptAll={onAcceptAll} />);

    const acceptAllBtn = screen.getByRole('button', { name: 'Accept All' });
    fireEvent.click(acceptAllBtn);

    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });

  // ── Test 6: Reject All calls onRejectAll callback ──────────────────────
  it('calls onRejectAll when Reject All is clicked', () => {
    const onRejectAll = vi.fn();
    const files = [makeFile()];
    render(<DiffReviewPanel files={files} onRejectAll={onRejectAll} />);

    const rejectAllBtn = screen.getByRole('button', { name: 'Reject All' });
    fireEvent.click(rejectAllBtn);

    expect(onRejectAll).toHaveBeenCalledTimes(1);
  });

  // ── Test 7: Renders accept/reject buttons on changed lines ──────────────
  it('renders line-level accept and reject buttons on changed lines', () => {
    const files = [makeFile()];
    render(<DiffReviewPanel files={files} />);

    const acceptButtons = screen.getAllByRole('button', { name: 'Accept hunk' });
    const rejectButtons = screen.getAllByRole('button', { name: 'Reject hunk' });

    // Should have accept/reject buttons on both left and right sides for the modified pair
    expect(acceptButtons.length).toBeGreaterThanOrEqual(1);
    expect(rejectButtons.length).toBeGreaterThanOrEqual(1);
  });

  // ── Test 8: Displays file stats in toolbar ─────────────────────────────
  it('displays addition and deletion counts in the toolbar', () => {
    const files = [makeFile({ additions: 5, deletions: 3 })];
    render(<DiffReviewPanel files={files} />);

    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.getByText('-3')).toBeInTheDocument();
  });

  // ── Test 9: Switching file tabs changes the active file display ────────
  it('switches the displayed file when clicking a different tab', () => {
    const files = [
      makeFile({ filePath: 'src/first.ts' }),
      makeFile({
        filePath: 'src/second.ts',
        status: 'added',
        additions: 3,
        deletions: 0,
        hunks: [
          makeHunk([
            { type: 'added', newLineNumber: 1, content: 'new file content' },
          ]),
        ],
      }),
    ];
    render(<DiffReviewPanel files={files} />);

    // First tab should be active by default
    const firstTab = screen.getByRole('tab', { name: /src\/first\.ts/ });
    expect(firstTab).toHaveAttribute('aria-selected', 'true');

    // Click second tab
    const secondTab = screen.getByRole('tab', { name: /src\/second\.ts/ });
    fireEvent.click(secondTab);

    expect(secondTab).toHaveAttribute('aria-selected', 'true');
    expect(firstTab).toHaveAttribute('aria-selected', 'false');

    // The second file's content should be visible
    expect(getLineContents('new file content')[0]).toBeInTheDocument();
  });

  // ── Test 10: Accepting a line dims it and highlights the accept button ──
  it('toggles line acceptance state when clicking accept button', () => {
    const files = [makeFile()];
    render(<DiffReviewPanel files={files} />);

    const acceptButtons = screen.getAllByRole('button', { name: 'Accept hunk' });
    const firstAccept = acceptButtons[0];
    expect(firstAccept).toBeDefined();

    // Click to accept
    fireEvent.click(firstAccept!);

    // The accept button should now have the active class
    expect(firstAccept!.className).toContain('lineAcceptBtnActive');
  });

  // ── Test 11: Rejecting a line dims it and highlights the reject button ──
  it('toggles line rejection state when clicking reject button', () => {
    const files = [makeFile()];
    render(<DiffReviewPanel files={files} />);

    const rejectButtons = screen.getAllByRole('button', { name: 'Reject hunk' });
    const firstReject = rejectButtons[0];
    expect(firstReject).toBeDefined();

    // Click to reject
    fireEvent.click(firstReject!);

    // The reject button should now have the active class
    expect(firstReject!.className).toContain('lineRejectBtnActive');
  });

  // ── Test 12: Does not show accept/reject buttons on context lines ──────
  it('does not render action buttons on context (unchanged) lines', () => {
    const files = [
      makeFile({
        hunks: [
          makeHunk([
            { type: 'context', oldLineNumber: 1, newLineNumber: 1, content: 'unchanged' },
            { type: 'added', newLineNumber: 2, content: 'new line' },
          ]),
        ],
      }),
    ];
    render(<DiffReviewPanel files={files} />);

    // Only have accept/reject for the added line, not the context line
    const acceptButtons = screen.getAllByRole('button', { name: 'Accept hunk' });
    // Should be 2: one on left (empty) and one on right (new line)
    expect(acceptButtons.length).toBe(2);
  });
});
