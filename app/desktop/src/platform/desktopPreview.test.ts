// Desktop PreviewPort content-URL resolution (#1817): absolute evidence URLs
// pass through; host-relative API paths resolve against the Local Edge base
// URL because Desktop owns the Edge connection.
import { describe, expect, it } from 'vitest';
import {
  resolveDesktopEvidenceContentUrl,
  resolveDesktopRuntimeEvidenceContent,
} from './desktopPreview';

describe('resolveDesktopEvidenceContentUrl', () => {
  it('returns absolute evidence URLs unchanged', () => {
    expect(resolveDesktopEvidenceContentUrl('http://127.0.0.1:4173/preview')).toBe(
      'http://127.0.0.1:4173/preview',
    );
    expect(resolveDesktopEvidenceContentUrl('https://preview.example.com/app')).toBe(
      'https://preview.example.com/app',
    );
  });

  it('resolves Edge-relative content paths against the Local Edge base URL', () => {
    // Default test-env Edge base URL (no override configured).
    expect(resolveDesktopEvidenceContentUrl('/v1/runs/run-1/artifacts/artifact-1/content')).toBe(
      'http://127.0.0.1:3210/v1/runs/run-1/artifacts/artifact-1/content',
    );
    expect(resolveDesktopEvidenceContentUrl('/v1/runs/run-1/previews/preview-1/content')).toBe(
      'http://127.0.0.1:3210/v1/runs/run-1/previews/preview-1/content',
    );
  });

  it('yields undefined for empty or non-URL references', () => {
    expect(resolveDesktopEvidenceContentUrl('')).toBeUndefined();
    expect(resolveDesktopEvidenceContentUrl('   ')).toBeUndefined();
    expect(resolveDesktopEvidenceContentUrl('# reports/runtime.patch')).toBeUndefined();
    expect(resolveDesktopEvidenceContentUrl('data:text/plain;base64,abc')).toBeUndefined();
  });
});

describe('resolveDesktopRuntimeEvidenceContent', () => {
  it('maps artifact refs onto the Edge artifact content endpoint', () => {
    expect(
      resolveDesktopRuntimeEvidenceContent({
        kind: 'artifact',
        runId: 'run-1',
        id: 'artifact-1',
      }),
    ).toBe('http://127.0.0.1:3210/v1/runs/run-1/artifacts/artifact-1/content');
  });

  it('maps preview refs onto the Edge preview content endpoint', () => {
    expect(
      resolveDesktopRuntimeEvidenceContent({
        kind: 'preview',
        runId: 'run-2',
        id: 'preview-2',
      }),
    ).toBe('http://127.0.0.1:3210/v1/runs/run-2/previews/preview-2/content');
  });
});
