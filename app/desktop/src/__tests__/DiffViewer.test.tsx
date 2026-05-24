import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import DiffViewer from '@/components/DiffViewer';
import type { FileDiff } from '@/components/ChatView.types';

function makeHunk(overrides: Partial<FileDiff['hunks'][number]> = {}) {
  return {
    header: '@@ -1,3 +1,4 @@',
    lines: [
      { type: 'context' as const, oldLineNumber: 1, newLineNumber: 1, content: 'unchanged line' },
      { type: 'deleted' as const, oldLineNumber: 2, content: 'removed line' },
      { type: 'added' as const, newLineNumber: 2, content: 'added line' },
      { type: 'context' as const, oldLineNumber: 3, newLineNumber: 3, content: 'more context' },
    ],
    ...overrides,
  };
}

function makeFile(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    filePath: 'src/foo.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    hunks: [makeHunk()],
    ...overrides,
  };
}

// Helper: find the file section in the diff panel by file path
function getDiffPanel(): HTMLElement {
  // The diff panel is the second child of the root grid
  const root = document.querySelector('[class*="root"]');
  const panels = root?.children ?? [];
  // First child is fileTree, second is diffPanel (or first if no tree on mobile)
  return (panels[1] ?? panels[0]) as HTMLElement;
}

describe('DiffViewer', () => {
  // ── Empty state ────────────────────────────────
  it('renders empty message when no files', () => {
    render(<DiffViewer files={[]} />);
    expect(screen.getByText('No changes to display')).toBeInTheDocument();
  });

  // ── File list rendering ────────────────────────
  it('renders a file section for each file in the list', () => {
    const files = [
      makeFile({ filePath: 'src/a.ts' }),
      makeFile({ filePath: 'src/b.ts' }),
    ];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    expect(within(panel).getByText('src/a.ts')).toBeInTheDocument();
    expect(within(panel).getByText('src/b.ts')).toBeInTheDocument();
  });

  // ── Status icons / badges ──────────────────────
  it('shows A badge for added files', () => {
    const files = [makeFile({ filePath: 'src/new.ts', status: 'added', deletions: 0 })];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    expect(within(panel).getByText('A')).toBeInTheDocument();
  });

  it('shows D badge for deleted files', () => {
    const files = [makeFile({ filePath: 'src/gone.ts', status: 'deleted', additions: 0 })];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    expect(within(panel).getByText('D')).toBeInTheDocument();
  });

  it('shows M badge for modified files', () => {
    const files = [makeFile({ filePath: 'src/mod.ts', status: 'modified' })];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    expect(within(panel).getByText('M')).toBeInTheDocument();
  });

  // ── Color coding via add/delete counts ─────────
  it('renders addition and deletion counts', () => {
    const files = [makeFile({ additions: 5, deletions: 3 })];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    expect(within(panel).getByText('+5')).toBeInTheDocument();
    expect(within(panel).getByText('-3')).toBeInTheDocument();
  });

  // ── Expand / collapse ──────────────────────────
  it('shows file body with hunks by default', () => {
    const files = [makeFile()];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    expect(within(panel).getByText('unchanged line')).toBeInTheDocument();
    expect(within(panel).getByText('@@ -1,3 +1,4 @@')).toBeInTheDocument();
  });

  it('collapses file body when header is clicked', () => {
    const files = [makeFile()];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    const headerBtn = within(panel).getByRole('button', { name: /src\/foo\.ts/ });
    fireEvent.click(headerBtn);
    expect(within(panel).queryByText('unchanged line')).not.toBeInTheDocument();
    expect(headerBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands file body when collapsed header is clicked again', () => {
    const files = [makeFile()];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    const headerBtn = within(panel).getByRole('button', { name: /src\/foo\.ts/ });
    fireEvent.click(headerBtn); // collapse
    fireEvent.click(headerBtn); // expand
    expect(within(panel).getByText('unchanged line')).toBeInTheDocument();
    expect(headerBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('is expanded by default', () => {
    const files = [makeFile()];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    const headerBtn = within(panel).getByRole('button', { name: /src\/foo\.ts/ });
    expect(headerBtn).toHaveAttribute('aria-expanded', 'true');
  });

  // ── Line types ─────────────────────────────────
  it('renders added, deleted, and context lines', () => {
    const files = [makeFile()];
    render(<DiffViewer files={files} />);
    expect(screen.getByText('added line')).toBeInTheDocument();
    expect(screen.getByText('removed line')).toBeInTheDocument();
    expect(screen.getByText('unchanged line')).toBeInTheDocument();
  });

  it('shows line sign for added lines', () => {
    const files = [makeFile()];
    render(<DiffViewer files={files} />);
    // Multiple + signs exist (counts and line signs), just check they exist
    const pluses = screen.getAllByText('+');
    expect(pluses.length).toBeGreaterThan(0);
  });

  it('shows line sign for deleted lines', () => {
    const files = [makeFile()];
    render(<DiffViewer files={files} />);
    const minuses = screen.getAllByText('-');
    expect(minuses.length).toBeGreaterThan(0);
  });

  // ── Accept callback ────────────────────────────
  it('calls onAcceptFile when accept button is clicked', () => {
    const onAccept = vi.fn();
    const files = [makeFile({ filePath: 'src/accept.ts' })];
    render(<DiffViewer files={files} onAcceptFile={onAccept} />);
    const panel = getDiffPanel();
    fireEvent.click(within(panel).getByLabelText('Accept file'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('src/accept.ts');
  });

  it('does not call onAcceptFile when no handler provided', () => {
    const files = [makeFile({ filePath: 'src/accept.ts' })];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    expect(() => fireEvent.click(within(panel).getByLabelText('Accept file'))).not.toThrow();
  });

  // ── Reject callback ────────────────────────────
  it('calls onRejectFile when reject button is clicked', () => {
    const onReject = vi.fn();
    const files = [makeFile({ filePath: 'src/reject.ts' })];
    render(<DiffViewer files={files} onRejectFile={onReject} />);
    const panel = getDiffPanel();
    fireEvent.click(within(panel).getByLabelText('Reject file'));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith('src/reject.ts');
  });

  it('does not call onRejectFile when no handler provided', () => {
    const files = [makeFile({ filePath: 'src/reject.ts' })];
    render(<DiffViewer files={files} />);
    const panel = getDiffPanel();
    expect(() => fireEvent.click(within(panel).getByLabelText('Reject file'))).not.toThrow();
  });

  // ── Hunk headers ───────────────────────────────
  it('renders hunk headers for each hunk', () => {
    const files = [
      makeFile({
        hunks: [
          makeHunk({ header: '@@ -1,2 +1,3 @@' }),
          makeHunk({ header: '@@ -10,4 +12,5 @@' }),
        ],
      }),
    ];
    render(<DiffViewer files={files} />);
    expect(screen.getByText('@@ -1,2 +1,3 @@')).toBeInTheDocument();
    expect(screen.getByText('@@ -10,4 +12,5 @@')).toBeInTheDocument();
  });

  // ── Multiple files each with own collapse ──────
  it('collapses only the clicked file', () => {
    const files = [
      makeFile({ filePath: 'src/first.ts' }),
      makeFile({ filePath: 'src/second.ts' }),
    ];
    render(<DiffViewer files={files} />);

    const panel = getDiffPanel();
    const firstBtn = within(panel).getByRole('button', { name: /src\/first\.ts/ });
    fireEvent.click(firstBtn);

    expect(within(panel).queryByText('@@ -1,3 +1,4 @@', { exact: false })).toBeInTheDocument();
    expect(firstBtn).toHaveAttribute('aria-expanded', 'false');

    const secondBtn = within(panel).getByRole('button', { name: /src\/second\.ts/ });
    expect(secondBtn).toHaveAttribute('aria-expanded', 'true');
  });

  // ── File tree sidebar ──────────────────────────
  it('renders the file tree sidebar with changed files count', () => {
    const files = [makeFile(), makeFile({ filePath: 'src/bar.ts' })];
    render(<DiffViewer files={files} />);
    expect(screen.getByText('2 changed files')).toBeInTheDocument();
  });
});
