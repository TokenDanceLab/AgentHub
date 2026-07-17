import { describe, expect, it } from 'vitest';
import { PREVIEW_SANDBOX_REMOTE, PREVIEW_SANDBOX_SRCDOC } from './previewSandbox';

describe('previewSandbox', () => {
  it('never pairs allow-scripts with allow-same-origin', () => {
    for (const token of [PREVIEW_SANDBOX_REMOTE, PREVIEW_SANDBOX_SRCDOC]) {
      expect(token).toContain('allow-scripts');
      expect(token).not.toContain('allow-same-origin');
    }
  });
});
