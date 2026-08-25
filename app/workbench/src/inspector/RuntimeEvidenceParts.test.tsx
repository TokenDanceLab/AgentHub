// Artifact download action through the platform PreviewPort (#1945).
//
// The renderer never constructs a host REST path: surfaces that own the
// backing runtime (desktop-shaped ports, `downloadArtifactContent` present)
// get a real download button wired to the port; surfaces without a reachable
// artifact content endpoint (web-shaped ports — Hub-only, no Hub content
// route) omit the method and degrade to the consistent unavailable notice.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewPort } from '@shared/platform';
import type { Artifact } from '@shared/types';
import { useToastStore } from '@shared/ui/toast/toastStore';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { RuntimeEvidenceArtifactsSection } from './RuntimeEvidenceParts';

// Render through the real English bundle so copy assertions are stable.
beforeAll(async () => {
  await useTestI18nLanguage('en');
});

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-1',
    runId: 'run-1',
    threadId: 'thread-1',
    kind: 'document',
    path: 'reports/summary.pdf',
    sizeBytes: 2048,
    createdAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
}

/** Desktop-shaped port: owns the backing runtime, download present. */
function desktopShapedPort(
  overrides: { downloadArtifactContent?: PreviewPort['downloadArtifactContent'] } = {},
): PreviewPort {
  return {
    openEvidence: vi.fn().mockResolvedValue(undefined),
    downloadArtifactContent: overrides.downloadArtifactContent ?? vi.fn().mockResolvedValue(undefined),
  };
}

/** Web-shaped port: Hub-only, no `downloadArtifactContent`. */
function webShapedPort(): PreviewPort {
  return { openEvidence: vi.fn().mockResolvedValue(undefined) };
}

function currentToasts() {
  return useToastStore.getState().toasts;
}

function renderSection(
  previewPort?: PreviewPort,
  artifacts: Artifact[] = [makeArtifact()],
  runId = 'run-1',
) {
  return render(
    <RuntimeEvidenceArtifactsSection
      artifacts={artifacts}
      diffCount={0}
      previewPort={previewPort}
      previews={[]}
      runId={runId || undefined}
    />,
  );
}

describe('RuntimeEvidenceArtifactsSection download action (#1945)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useToastStore.setState({ toasts: [] });
  });

  it('routes the download through PreviewPort.downloadArtifactContent with a neutral ref', async () => {
    const port = desktopShapedPort();
    renderSection(port);

    fireEvent.click(screen.getByRole('button', { name: 'Download artifact' }));

    await waitFor(() => {
      expect(port.downloadArtifactContent).toHaveBeenCalledTimes(1);
    });
    expect(port.downloadArtifactContent).toHaveBeenCalledWith({
      ref: { kind: 'artifact', runId: 'run-1', id: 'artifact-1' },
      suggestedName: 'summary.pdf',
    });
  });

  it('uses the artifact path basename as the suggested download name', async () => {
    const port = desktopShapedPort();
    renderSection(port, [makeArtifact({ path: 'dist\\bundle/app.js', id: 'artifact-2' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Download artifact' }));

    await waitFor(() => {
      expect(port.downloadArtifactContent).toHaveBeenCalledWith({
        ref: { kind: 'artifact', runId: 'run-1', id: 'artifact-2' },
        suggestedName: 'app.js',
      });
    });
  });

  it('web-shaped port degrades to the unavailable notice instead of a button', () => {
    renderSection(webShapedPort());

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download artifact' })).toBeNull();
  });

  it('missing port entirely still degrades to the unavailable notice', () => {
    renderSection(undefined);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('disables the button when no run id can resolve the artifact ref', () => {
    renderSection(desktopShapedPort(), [makeArtifact({ runId: '' })], '');
    expect(screen.getByRole('button', { name: 'Download artifact' })).toBeDisabled();
  });

  it('surfaces a port failure as an error toast instead of failing silently', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = desktopShapedPort({
      downloadArtifactContent: vi.fn().mockRejectedValue(new Error('edge offline')),
    });
    renderSection(port);

    fireEvent.click(screen.getByRole('button', { name: 'Download artifact' }));

    await waitFor(() => {
      expect(currentToasts().some((toast) => toast.type === 'error')).toBe(true);
    });
    expect(consoleError).toHaveBeenCalled();
  });

  it('renders the unavailable notice consistently in zh and en', async () => {
    renderSection(webShapedPort());
    const notice = screen.getByRole('status');

    await useTestI18nLanguage('zh');
    await waitFor(() => {
      expect(notice.textContent).toBe('下载不可用：当前端无产物内容端点。');
    });

    await useTestI18nLanguage('en');
    await waitFor(() => {
      expect(notice.textContent).toBe(
        'Download unavailable: this client has no artifact content endpoint.',
      );
    });
  });
});
