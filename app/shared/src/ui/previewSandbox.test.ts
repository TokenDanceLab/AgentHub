import { describe, expect, it } from 'vitest';
import {
  PREVIEW_SANDBOX_REMOTE,
  PREVIEW_SANDBOX_SRCDOC,
  isSafeRemotePreviewUrl,
} from './previewSandbox';

describe('previewSandbox', () => {
  it('never pairs allow-scripts with allow-same-origin', () => {
    for (const token of [PREVIEW_SANDBOX_REMOTE, PREVIEW_SANDBOX_SRCDOC]) {
      expect(token).toContain('allow-scripts');
      expect(token).not.toContain('allow-same-origin');
    }
  });
});

describe('isSafeRemotePreviewUrl', () => {
  it('allows http(s) absolute URLs', () => {
    expect(isSafeRemotePreviewUrl('https://example.com')).toBe(true);
    expect(isSafeRemotePreviewUrl('http://127.0.0.1:3210/preview')).toBe(true);
  });

  it('rejects non-http schemes and unparseable/relative URLs', () => {
    expect(isSafeRemotePreviewUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeRemotePreviewUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isSafeRemotePreviewUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeRemotePreviewUrl('blob:https://example.com/123')).toBe(false);
    expect(isSafeRemotePreviewUrl('/relative/preview')).toBe(false);
    expect(isSafeRemotePreviewUrl('')).toBe(false);
    expect(isSafeRemotePreviewUrl('not a url')).toBe(false);
  });

  it('rejects userinfo-carrying URLs (#1933)', () => {
    expect(isSafeRemotePreviewUrl('http://user:pass@example.com/')).toBe(false); // # leak-guard-allow:LG-F4C6A155 (fake fixture)
    expect(isSafeRemotePreviewUrl('https://user:pass@example.com/deep/path?q=1')).toBe(false); // # leak-guard-allow:LG-F4C6A155 (fake fixture)
    expect(isSafeRemotePreviewUrl('https://user@example.com')).toBe(false);
    expect(isSafeRemotePreviewUrl('HTTPS://USER:PASS@EXAMPLE.COM')).toBe(false); // # leak-guard-allow:LG-F4C6A155 (fake fixture)
    // '@' outside the authority (path segment) is not userinfo and stays allowed.
    expect(isSafeRemotePreviewUrl('https://example.com/@handle')).toBe(true);
    expect(isSafeRemotePreviewUrl('https://example.com/path?a=b@c')).toBe(true);
  });
});
