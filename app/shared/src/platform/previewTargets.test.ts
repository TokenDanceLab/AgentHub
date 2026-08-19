// real_tested=true
import { describe, expect, it } from 'vitest';
import type { EvidenceRef } from '../transcript';
import { resolveEvidencePreviewTarget } from './previewTargets';

function evidenceRef(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return { id: 'ev-1', kind: 'file', label: 'main.go', ...overrides };
}

describe('resolveEvidencePreviewTarget', () => {
  it('returns the trimmed uri as the direct target', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ uri: '  https://x.dev/out  ' })),
    ).toBe('https://x.dev/out');
  });

  it('returns the trimmed path when uri is missing', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ path: ' /tmp/out.html ' })),
    ).toBe('/tmp/out.html');
  });

  it('prefers uri over path when both are present', () => {
    expect(
      resolveEvidencePreviewTarget(
        evidenceRef({ uri: 'https://x.dev/a', path: '/tmp/b' }),
      ),
    ).toBe('https://x.dev/a');
  });

  it('skips a whitespace-only uri and falls back to the path', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ uri: '   ', path: '/tmp/b' })),
    ).toBe('/tmp/b');
  });

  it('skips an empty-string uri and falls back to the path', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ uri: '', path: '/tmp/b' })),
    ).toBe('/tmp/b');
  });

  it('falls back to an http label', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ label: 'http://x.dev/app' })),
    ).toBe('http://x.dev/app');
  });

  it('falls back to an https label', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ label: 'https://x.dev/app' })),
    ).toBe('https://x.dev/app');
  });

  it('falls back to a file:// label', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ label: 'file:///tmp/report.html' })),
    ).toBe('file:///tmp/report.html');
  });

  it('matches url-like labels case-insensitively', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ label: 'HTTPS://x.dev/app' })),
    ).toBe('HTTPS://x.dev/app');
  });

  it('falls back to an absolute-path label', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ label: '/tmp/index.html' })),
    ).toBe('/tmp/index.html');
  });

  it('falls back to a relative-path label', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ label: './index.html' })),
    ).toBe('./index.html');
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ label: '../index.html' })),
    ).toBe('../index.html');
  });

  it('falls back to a windows-path label', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ label: 'C:\\out\\index.html' })),
    ).toBe('C:\\out\\index.html');
  });

  it('rejects labels that are neither url-like nor path-like', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ label: 'just some text' })),
    ).toBeUndefined();
  });

  it('returns undefined when all candidate fields are missing', () => {
    expect(resolveEvidencePreviewTarget(evidenceRef())).toBeUndefined();
    expect(resolveEvidencePreviewTarget(evidenceRef({ label: '   ' }))).toBeUndefined();
  });

  it('trims the label before matching', () => {
    expect(
      resolveEvidencePreviewTarget(evidenceRef({ label: '  /tmp/trimmed.html  ' })),
    ).toBe('/tmp/trimmed.html');
  });

  it('falls back to the label when uri and path are blank', () => {
    expect(
      resolveEvidencePreviewTarget(
        evidenceRef({ uri: '  ', path: '', label: 'https://x.dev/label-only' }),
      ),
    ).toBe('https://x.dev/label-only');
  });

  it('ignores non-target fields like id and kind', () => {
    expect(
      resolveEvidencePreviewTarget(
        evidenceRef({ id: 'ev-9', kind: 'preview' }),
      ),
    ).toBeUndefined();
  });
});
