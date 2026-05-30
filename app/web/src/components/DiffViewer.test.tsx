import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import DiffViewer from './DiffViewer';
import type { FileDiff } from './ChatView.types';

const sampleDiff: FileDiff = {
  filePath: 'app/web/src/components/DiffViewer.tsx',
  status: 'modified',
  additions: 2,
  deletions: 1,
  hunks: [
    {
      header: '@@ -1,2 +1,3 @@',
      lines: [
        { type: 'context', oldLineNumber: 1, newLineNumber: 1, content: 'import React from "react";' },
        { type: 'deleted', oldLineNumber: 2, content: 'const copy = "No changes to display";' },
        { type: 'added', newLineNumber: 2, content: 'const copy = t("diff.empty.title");' },
      ],
    },
  ],
};

describe('DiffViewer', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the shared empty state through Web i18n', () => {
    render(<DiffViewer files={[]} />);

    expect(screen.getByRole('region', { name: 'No changes to display' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No changes to display' })).toBeInTheDocument();
    expect(screen.getByText('Diff output will appear here after the run reports changed files.')).toBeInTheDocument();
  });

  it('localizes file controls and invokes file decisions', () => {
    const onAcceptFile = vi.fn();
    const onRejectFile = vi.fn();

    render(<DiffViewer files={[sampleDiff]} onAcceptFile={onAcceptFile} onRejectFile={onRejectFile} />);

    expect(screen.getByText('1 changed file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand all files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse all files' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accept file' }));
    expect(onAcceptFile).toHaveBeenCalledWith(sampleDiff.filePath);
    expect(screen.getByRole('button', { name: 'Undo accept' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reject file' }));
    expect(onRejectFile).toHaveBeenCalledWith(sampleDiff.filePath);
    expect(screen.getByRole('button', { name: 'Undo reject' })).toBeInTheDocument();
  });
});
