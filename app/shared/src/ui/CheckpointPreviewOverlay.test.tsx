// CheckpointPreviewOverlay behavior (#1968): read-only pre-run snapshot
// preview. Asserts the fetch lifecycle against a fake port, the honest
// degradation paths (no port, vanished checkpoint, transport failure), and
// the load-bearing honesty contract: restore is never offered.
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CheckpointFileContent, CheckpointPort, CheckpointSummary } from '../platform/types';
import { CheckpointPreviewOverlay, formatCheckpointBytes } from './CheckpointPreviewOverlay';

const labels = {
  summary: '{{count}} files · {{bytes}} total',
  fileListAria: 'Snapshot file list',
  selectFile: 'Select a file to view its pre-run content',
  emptyContent: 'No text preview for this file (binary or over the size cap).',
  absent: 'No snapshot found for this run; nothing to preview.',
  restoreUnavailable: 'Restore is not wired; read-only preview only.',
  surfaceUnavailable: 'This surface cannot reach snapshot content.',
  loadFailed: 'Failed to load the snapshot; try again later.',
};

const baseSummary: CheckpointSummary = {
  runId: 'run-1',
  checkpointId: 'cp-run-1',
  workDir: '/tmp/project',
  fileCount: 2,
  totalBytes: 1536,
  createdAt: '2026-08-26T00:00:00Z',
  files: [
    { path: 'src/a.ts', sizeBytes: 512, hash: 'h-a', hasText: true },
    { path: 'assets/logo.png', sizeBytes: 1024, hash: 'h-b', hasText: false },
  ],
};

function makePort(overrides: Partial<CheckpointPort> = {}): CheckpointPort {
  return {
    list: vi.fn().mockResolvedValue(baseSummary),
    file: vi.fn().mockResolvedValue({
      runId: 'run-1', path: 'src/a.ts', sizeBytes: 512, hash: 'h-a', content: 'const a = 1;',
    } satisfies CheckpointFileContent),
    ...overrides,
  };
}

function renderOverlay(props: Partial<React.ComponentProps<typeof CheckpointPreviewOverlay>> = {}) {
  return render(
    <CheckpointPreviewOverlay
      open
      runId="run-1"
      title="Pre-run snapshot (read-only)"
      closeLabel="Close snapshot preview"
      labels={labels}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe('CheckpointPreviewOverlay (#1968)', () => {
  it('renders nothing while closed', () => {
    render(
      <CheckpointPreviewOverlay
        open={false} runId="run-1" title="t" closeLabel="c" labels={labels} onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('checkpoint-preview-overlay')).toBeNull();
  });

  it('always shows the restore-unavailable notice — restore is never offered', async () => {
    renderOverlay({ port: makePort() });
    await waitFor(() => expect(screen.getByTestId('checkpoint-restore-notice')).toBeInTheDocument());
    expect(screen.getByTestId('checkpoint-restore-notice')).toHaveTextContent('Restore is not wired');
    // No restore affordance anywhere in the dialog.
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull();
  });

  it('shows the honest surface notice and never fetches without a port', () => {
    renderOverlay(); // no port (Web, Hub-only)
    expect(screen.getByTestId('checkpoint-surface-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('checkpoint-loading')).toBeNull();
  });

  it('loads the inventory and renders file list + formatted summary', async () => {
    const port = makePort();
    renderOverlay({ port });
    expect(await screen.findByLabelText('Snapshot file list')).toBeInTheDocument();
    expect(port.list).toHaveBeenCalledWith('run-1');
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('assets/logo.png')).toBeInTheDocument();
    expect(screen.getByText('2 files · 1.5 KB total')).toBeInTheDocument();
  });

  it('fetches and shows pre-run content when a text file is selected', async () => {
    const port = makePort();
    renderOverlay({ port });
    fireEvent.click(await screen.findByText('src/a.ts'));
    const content = await screen.findByTestId('checkpoint-file-content');
    expect(content).toHaveTextContent('const a = 1;');
    expect(port.file).toHaveBeenCalledWith('run-1', 'src/a.ts');
  });

  it('shows emptyContent without fetching for a binary file (hasText=false)', async () => {
    const port = makePort();
    renderOverlay({ port });
    fireEvent.click(await screen.findByText('assets/logo.png'));
    expect(await screen.findByTestId('checkpoint-empty-content')).toBeInTheDocument();
    expect(port.file).not.toHaveBeenCalled();
  });

  it('shows the absent notice when the run has no checkpoint (honest absence)', async () => {
    const port = makePort({ list: vi.fn().mockResolvedValue(undefined) });
    renderOverlay({ port });
    expect(await screen.findByTestId('checkpoint-absent')).toBeInTheDocument();
  });

  it('shows loadFailed when the inventory fetch rejects', async () => {
    const port = makePort({ list: vi.fn().mockRejectedValue(new Error('boom')) });
    renderOverlay({ port });
    expect(await screen.findByTestId('checkpoint-load-failed')).toBeInTheDocument();
  });

  it('shows loadFailed when a file fetch rejects', async () => {
    const port = makePort({ file: vi.fn().mockRejectedValue(new Error('boom')) });
    renderOverlay({ port });
    fireEvent.click(await screen.findByText('src/a.ts'));
    expect(await screen.findByTestId('checkpoint-file-failed')).toBeInTheDocument();
  });

  it('shows the selectFile placeholder before any file is selected', async () => {
    renderOverlay({ port: makePort() });
    expect(await screen.findByTestId('checkpoint-select-file')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderOverlay({ port: makePort(), onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('formatCheckpointBytes (#1968)', () => {
  it('formats bytes, KB, MB with one decimal', () => {
    expect(formatCheckpointBytes(0)).toBe('0 B');
    expect(formatCheckpointBytes(999)).toBe('999 B');
    expect(formatCheckpointBytes(1536)).toBe('1.5 KB');
    expect(formatCheckpointBytes(2 * 1000 * 1000)).toBe('2.0 MB');
  });

  it('clamps invalid input to 0 B', () => {
    expect(formatCheckpointBytes(-5)).toBe('0 B');
    expect(formatCheckpointBytes(Number.NaN)).toBe('0 B');
  });
});
