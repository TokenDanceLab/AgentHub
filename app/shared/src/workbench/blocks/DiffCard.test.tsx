import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiffCard } from './DiffCard';

describe('DiffCard', () => {
  it('renders diff proposal review evidence and export action without apply or revert buttons', () => {
    const onExportEvidence = vi.fn();
    render(
      <DiffCard
        filename="src/review.ts"
        additions={2}
        deletions={1}
        lines={[{ type: 'add', content: 'const approved = true;' }]}
        reviewStatus="approved"
        canApply={false}
        canRevert={true}
        editId="edit-1"
        hash="sha256:diff-1"
        artifactId="artifact-1"
        approvalId="approval-1"
        correlationId="corr-1"
        onExportEvidence={onExportEvidence}
      />,
    );

    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.getByText('can_apply: false')).toBeInTheDocument();
    expect(screen.getByText('can_revert: true')).toBeInTheDocument();
    expect(screen.getByText('edit edit-1')).toBeInTheDocument();
    expect(screen.getByText('hash sha256:diff-1')).toBeInTheDocument();
    expect(screen.getByText('artifact artifact-1')).toBeInTheDocument();
    expect(screen.getByText('approval approval-1')).toBeInTheDocument();
    expect(screen.getByText('corr corr-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revert/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Export evidence' }));

    expect(onExportEvidence).toHaveBeenCalledTimes(1);
  });
});
