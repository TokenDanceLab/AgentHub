import React, { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunReviewOverlay } from './RunReviewOverlay';
import type { DiffReviewFile } from './DiffReviewPanelTypes';

const fileA: DiffReviewFile = {
  filePath: 'src/a.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  hunks: [{
    header: '@@ -1,2 +1,2 @@',
    lines: [
      { type: 'deleted', oldLineNumber: 1, content: 'const old = 1;' },
      { type: 'added', newLineNumber: 1, content: 'const next = 2;' },
    ],
  }],
};

const fileB: DiffReviewFile = {
  filePath: 'src/b.ts',
  status: 'added',
  additions: 2,
  deletions: 0,
  hunks: [{
    header: '@@ -0,0 +1,2 @@',
    lines: [
      { type: 'added', newLineNumber: 1, content: 'export const b = 1;' },
      { type: 'added', newLineNumber: 2, content: 'export const c = 2;' },
    ],
  }],
};

const baseProps = {
  files: [fileA, fileB],
  title: 'Run change review',
  closeLabel: 'Close run change review',
};

/** Controlled harness — the overlay must be host-driven (open/onClose). */
function Harness({ overlayProps }: { overlayProps?: Partial<React.ComponentProps<typeof RunReviewOverlay>> }) {
  const [open, setOpen] = useState(false);
  const onClose = useCallback(() => setOpen(false), []);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>open-overlay</button>
      <RunReviewOverlay open={open} onClose={onClose} {...baseProps} {...overlayProps} />
    </div>
  );
}

describe('RunReviewOverlay (#1967)', () => {
  it('renders nothing while closed', () => {
    render(<RunReviewOverlay open={false} onClose={() => {}} {...baseProps} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('run-review-overlay')).toBeNull();
  });

  it('renders an accessible dialog with the aggregated files when open', () => {
    render(<RunReviewOverlay open onClose={() => {}} {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Run change review');
    // Every run file lands in the panel's tab strip (paths also repeat in
    // the toolbar/column headers, hence getAllByText).
    expect(screen.getAllByText('src/a.ts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('src/b.ts').length).toBeGreaterThan(0);
  });

  it('shows the host summary line and the read-only notice', () => {
    render(
      <RunReviewOverlay
        open
        onClose={() => {}}
        {...baseProps}
        summary="2 files · +3 −1"
        readOnly
        readOnlyNotice="Aggregate review is read-only."
      />,
    );
    expect(screen.getByText('2 files · +3 −1')).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText('Aggregate review is read-only.')).toBeDefined();
  });

  it('omits the read-only notice when a write-back port is wired', () => {
    render(<RunReviewOverlay open onClose={() => {}} {...baseProps} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hides run, file, and hunk write-back actions in read-only mode', () => {
    render(
      <RunReviewOverlay
        open
        readOnly
        readOnlyNotice="Inspection only."
        onClose={() => {}}
        {...baseProps}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Accept run' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject run' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept All' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept hunk' })).toBeNull();
  });

  it('hosts the run-level toolbar and forwards accept/reject-run', async () => {
    const user = userEvent.setup();
    const onAcceptRun = vi.fn();
    const onRejectRun = vi.fn();
    render(
      <RunReviewOverlay
        open
        onClose={() => {}}
        {...baseProps}
        onAcceptRun={onAcceptRun}
        onRejectRun={onRejectRun}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Accept run' }));
    expect(onAcceptRun).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Reject run' }));
    expect(onRejectRun).toHaveBeenCalledTimes(1);
  });

  it('closes on the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RunReviewOverlay open onClose={onClose} {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Close run change review' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RunReviewOverlay open onClose={onClose} {...baseProps} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click but not on content click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RunReviewOverlay open onClose={onClose} {...baseProps} />);
    // Click inside the panel content — must NOT close.
    await user.click(screen.getAllByText('src/a.ts')[0]!);
    expect(onClose).not.toHaveBeenCalled();
    // Click the scrim itself — closes.
    await user.click(screen.getByTestId('run-review-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the dialog on open and returns it to the trigger on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'open-overlay' });
    trigger.focus();
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('locks body scroll while open and restores it on close', () => {
    const { rerender } = render(<RunReviewOverlay open onClose={() => {}} {...baseProps} />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<RunReviewOverlay open={false} onClose={() => {}} {...baseProps} />);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('passes translated panel labels through to the panel', () => {
    render(
      <RunReviewOverlay
        open
        onClose={() => {}}
        {...baseProps}
        panelLabels={{ acceptRun: '整体批准', rejectRun: '整体驳回', runTitle: '本次运行的全部变更' }}
      />,
    );
    expect(screen.getByText('本次运行的全部变更')).toBeDefined();
    expect(screen.getByRole('button', { name: '整体批准' })).toBeDefined();
    expect(screen.getByRole('button', { name: '整体驳回' })).toBeDefined();
  });
});
