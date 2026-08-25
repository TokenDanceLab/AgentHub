// Interactive diff apply dispatch through the platform PreviewPort (#1817).
//
// The shared package owns no Local Edge, so hunk write-back must be routed
// through the port: desktop-shaped ports (apply methods present) receive the
// decisions, web-shaped ports (apply methods absent — Hub-only boundary)
// degrade to explicit read-only feedback instead of silent console errors.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewPort } from '@shared/platform';
import { useToastStore } from '@shared/ui/toast/toastStore';
import { FilePreviewRouter, type PreviewFile } from './FilePreviewRouter';

function interactiveDiffFile(): PreviewFile {
  return {
    name: 'src/app.ts',
    type: 'diff',
    interactiveDiff: {
      runId: 'run-1',
      workDir: '/work/project',
      fileDiff: {
        filePath: 'src/app.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        hunks: [{
          header: '@@ -1 +1 @@',
          lines: [
            { type: 'deleted', content: 'const legacy = true;' },
            { type: 'added', content: 'const modern = true;' },
          ],
        }],
      },
    },
  };
}

/** Desktop-shaped port: apply methods present (Local Edge write-back). */
function desktopShapedPort(overrides: {
  applyRunDiff?: PreviewPort['applyRunDiff'];
  applyAllRunDiffs?: PreviewPort['applyAllRunDiffs'];
} = {}): PreviewPort {
  return {
    openEvidence: vi.fn().mockResolvedValue(undefined),
    applyRunDiff: overrides.applyRunDiff ?? vi.fn().mockResolvedValue(undefined),
    applyAllRunDiffs: overrides.applyAllRunDiffs ?? vi.fn().mockResolvedValue(undefined),
  };
}

/** Web-shaped port: Hub-only surface, no apply methods, content resolution only. */
function webShapedPort(): PreviewPort {
  return {
    openEvidence: vi.fn().mockResolvedValue(undefined),
    resolveContentUrl: (ref: string) => (/^https?:\/\//i.test(ref) ? ref : undefined),
  };
}

function currentToasts() {
  return useToastStore.getState().toasts;
}

describe('FilePreviewRouter interactive diff apply dispatch (#1817)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useToastStore.setState({ toasts: [] });
  });

  it('routes a single hunk accept through PreviewPort.applyRunDiff and toasts success', async () => {
    const port = desktopShapedPort();
    render(
      <FilePreviewRouter
        file={interactiveDiffFile()}
        onClose={vi.fn()}
        previewPort={port}
      />,
    );

    // Supported surface: no read-only capability notice.
    expect(screen.queryByRole('note')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Accept hunk' })[0]!);

    await waitFor(() => {
      expect(port.applyRunDiff).toHaveBeenCalledTimes(1);
    });
    expect(port.applyRunDiff).toHaveBeenCalledWith({
      runId: 'run-1',
      workDir: '/work/project',
      decision: { filePath: 'src/app.ts', hunkIndex: 0, accepted: true },
    });

    await waitFor(() => {
      expect(currentToasts().some((toast) => toast.type === 'success')).toBe(true);
    });
  });

  it('routes a single hunk reject through PreviewPort.applyRunDiff with accepted=false', async () => {
    const port = desktopShapedPort();
    render(
      <FilePreviewRouter
        file={interactiveDiffFile()}
        onClose={vi.fn()}
        previewPort={port}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Reject hunk' })[0]!);

    await waitFor(() => {
      expect(port.applyRunDiff).toHaveBeenCalledWith({
        runId: 'run-1',
        workDir: '/work/project',
        decision: { filePath: 'src/app.ts', hunkIndex: 0, accepted: false },
      });
    });
  });

  it('surfaces port failures as an error toast instead of failing silently', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = desktopShapedPort({
      applyRunDiff: vi.fn().mockRejectedValue(new Error('workdir not allowed')),
    });
    render(
      <FilePreviewRouter
        file={interactiveDiffFile()}
        onClose={vi.fn()}
        previewPort={port}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Accept hunk' })[0]!);

    await waitFor(() => {
      expect(currentToasts().some((toast) => toast.type === 'error')).toBe(true);
    });
    // #1826: the user-facing toast carries i18n copy; the raw error detail
    // stays in the console for diagnosis instead of leaking into the toast.
    expect(consoleError).toHaveBeenCalled();
  });

  it('routes accept-all through PreviewPort.applyAllRunDiffs with every hunk decision', async () => {
    const port = desktopShapedPort();
    render(
      <FilePreviewRouter
        file={interactiveDiffFile()}
        onClose={vi.fn()}
        previewPort={port}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Accept All' }));

    await waitFor(() => {
      expect(port.applyAllRunDiffs).toHaveBeenCalledTimes(1);
    });
    expect(port.applyAllRunDiffs).toHaveBeenCalledWith({
      runId: 'run-1',
      workDir: '/work/project',
      decisions: [{ filePath: 'src/app.ts', hunkIndex: 0, accepted: true }],
    });

    await waitFor(() => {
      expect(currentToasts().some((toast) => toast.type === 'success')).toBe(true);
    });
  });

  it('routes reject-all through PreviewPort.applyAllRunDiffs with accepted=false decisions', async () => {
    const port = desktopShapedPort();
    render(
      <FilePreviewRouter
        file={interactiveDiffFile()}
        onClose={vi.fn()}
        previewPort={port}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reject All' }));

    await waitFor(() => {
      expect(port.applyAllRunDiffs).toHaveBeenCalledWith({
        runId: 'run-1',
        workDir: '/work/project',
        decisions: [{ filePath: 'src/app.ts', hunkIndex: 0, accepted: false }],
      });
    });
  });

  it('web-shaped port renders the read-only notice and hides every write-back action', () => {
    const port = webShapedPort();
    render(
      <FilePreviewRouter
        file={interactiveDiffFile()}
        onClose={vi.fn()}
        previewPort={port}
      />,
    );

    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept hunk' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject hunk' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept All' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject All' })).toBeNull();
    expect(currentToasts()).toHaveLength(0);
    expect(port.applyRunDiff).toBeUndefined();
    expect(port.applyAllRunDiffs).toBeUndefined();
  });

  it('missing port entirely still degrades to the explicit read-only notice', () => {
    render(
      <FilePreviewRouter
        file={interactiveDiffFile()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept hunk' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept All' })).toBeNull();
  });
});
