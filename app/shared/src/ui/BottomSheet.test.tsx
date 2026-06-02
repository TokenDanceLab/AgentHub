import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomSheet } from './BottomSheet';

describe('BottomSheet', () => {
  it('renders dialog title, description, body, and footer', () => {
    render(
      <BottomSheet
        ariaLabel="Confirm approval decision"
        title="Confirm approval decision"
        closeLabel="Close approval decision"
        eyebrow="Approve"
        description="Confirm approve for this checkpoint."
        onClose={vi.fn()}
        footer={<button type="button">Confirm approve</button>}
      >
        <div role="status">Ready to submit decision.</div>
      </BottomSheet>,
    );

    expect(screen.getByRole('dialog', { name: 'Confirm approval decision' })).toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Confirm approve for this checkpoint.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Ready to submit decision.');
    expect(screen.getByRole('button', { name: 'Confirm approve' })).toBeInTheDocument();
  });

  it('fires close from the scrim and close button', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet
        ariaLabel="Resource details"
        title="Resource details"
        closeLabel="Close resource details"
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Close resource details' })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close resource details' })[1]!);

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('accepts mobile class overrides', () => {
    render(
      <BottomSheet
        ariaLabel="Clear session"
        title="Clear session"
        closeLabel="Close clear session"
        onClose={vi.fn()}
        layerClassName="mobileSheetLayer"
        sheetClassName="mobileBottomSheet"
        closeButtonClassName="mobileIconButton"
      />,
    );

    expect(screen.getByRole('presentation')).toHaveClass('mobileSheetLayer');
    expect(screen.getByRole('dialog')).toHaveClass('mobileBottomSheet');
    expect(screen.getAllByRole('button', { name: 'Close clear session' })[1]).toHaveClass('mobileIconButton');
  });
});
