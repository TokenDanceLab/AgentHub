import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';

// Mock syntaxHighlight so we don't load the heavy Prism/refractor bundle.
vi.mock('./syntaxHighlight', () => ({
  highlightLine: (content: string) => content,
  highlightLineWithWordDiff: (content: string) => content,
}));

import {
  DiffReviewFileTabs,
  DiffReviewToolbar,
} from './DiffReviewPanelParts';
import type { DiffReviewFile } from './DiffReviewPanelTypes';

const mockFiles: DiffReviewFile[] = [
  { filePath: 'src/index.ts', status: 'modified', hunks: [] },
  { filePath: 'src/utils.ts', status: 'added', hunks: [] },
  { filePath: 'src/old.ts', status: 'deleted', hunks: [] },
];

describe('DiffReviewFileTabs', () => {
  it('renders a tab for each file', () => {
    render(
      <DiffReviewFileTabs files={mockFiles} safeIndex={0} onSelectFile={vi.fn()} />,
    );
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('src/utils.ts')).toBeInTheDocument();
    expect(screen.getByText('src/old.ts')).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected', () => {
    render(
      <DiffReviewFileTabs files={mockFiles} safeIndex={1} onSelectFile={vi.fn()} />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSelectFile with the correct index when a tab is clicked', () => {
    const onSelectFile = vi.fn();
    render(
      <DiffReviewFileTabs files={mockFiles} safeIndex={0} onSelectFile={onSelectFile} />,
    );
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[2]);
    expect(onSelectFile).toHaveBeenCalledWith(2);
  });
});

describe('DiffReviewToolbar', () => {
  it('renders file path and diff stats', () => {
    render(
      <DiffReviewToolbar
        filePath="src/index.ts"
        additions={5}
        deletions={2}
        modifiedCount={3}
        acceptAllLabel="Accept all"
        rejectAllLabel="Reject all"
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(screen.getByText('~3')).toBeInTheDocument();
  });

  it('does not show modified count when zero', () => {
    render(
      <DiffReviewToolbar
        filePath="src/index.ts"
        additions={1}
        deletions={1}
        modifiedCount={0}
        acceptAllLabel="Accept all"
        rejectAllLabel="Reject all"
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
      />,
    );
    expect(screen.queryByText('~0')).not.toBeInTheDocument();
  });

  it('calls onAcceptAll and onRejectAll when buttons are clicked', () => {
    const onAcceptAll = vi.fn();
    const onRejectAll = vi.fn();
    render(
      <DiffReviewToolbar
        filePath="src/index.ts"
        additions={1}
        deletions={1}
        modifiedCount={0}
        acceptAllLabel="Accept all"
        rejectAllLabel="Reject all"
        onAcceptAll={onAcceptAll}
        onRejectAll={onRejectAll}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reject all' }));
    expect(onRejectAll).toHaveBeenCalledTimes(1);
  });
});

describe('DiffReviewFileTabs roving tabindex (#1823)', () => {
  it('moves focus with Arrow keys without changing the selected file', () => {
    const onSelectFile = vi.fn();
    render(
      <DiffReviewFileTabs files={mockFiles} safeIndex={0} onSelectFile={onSelectFile} />,
    );
    const tabs = screen.getAllByRole('tab');
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });

    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]).toHaveAttribute('tabindex', '0');
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');
    // Activation stays on click/Enter — selection unchanged by arrows.
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it('wraps around with ArrowLeft and supports Home/End', () => {
    render(
      <DiffReviewFileTabs files={mockFiles} safeIndex={0} onSelectFile={vi.fn()} />,
    );
    const tabs = screen.getAllByRole('tab');
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2]);

    fireEvent.keyDown(tabs[2]!, { key: 'End' });
    expect(document.activeElement).toBe(tabs[2]);

    fireEvent.keyDown(tabs[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('exposes shared tab/panel ids when tabsId is provided', () => {
    const tabsId = 'diff-tabs';
    render(
      <DiffReviewFileTabs files={mockFiles} safeIndex={1} tabsId={tabsId} onSelectFile={vi.fn()} />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('id', 'diff-tabs-tab-0');
    expect(tabs[0]).toHaveAttribute('aria-controls', 'diff-tabs-panel');
    expect(tabs[1]).toHaveAttribute('id', 'diff-tabs-tab-1');
  });

  it('moves the roving stop to the clicked file tab (#1823)', () => {
    const onSelectFile = vi.fn();
    render(
      <DiffReviewFileTabs files={mockFiles} safeIndex={0} onSelectFile={onSelectFile} />,
    );
    const tabs = screen.getAllByRole('tab');
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(tabs[1]).toHaveAttribute('tabindex', '0');

    // A click activates another tab — the roving stop must follow it so the
    // next Tab press returns to the clicked tab, not the stale focused one.
    fireEvent.click(tabs[2]!);
    expect(onSelectFile).toHaveBeenCalledWith(2);
    expect(tabs[2]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');
  });
});
