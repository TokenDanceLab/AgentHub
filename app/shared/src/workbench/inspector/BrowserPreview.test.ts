import { describe, expect, it } from 'vitest';
import {
  THEMED_BLANK_PREVIEW_SRCDOC,
  isThemedBlankPreviewUrl,
} from './BrowserPreview';

describe('BrowserPreview themed blank', () => {
  it('treats about:blank (and empty) as themed blank URLs', () => {
    expect(isThemedBlankPreviewUrl('about:blank')).toBe(true);
    expect(isThemedBlankPreviewUrl(' about:blank ')).toBe(true);
    expect(isThemedBlankPreviewUrl('about:blank#')).toBe(true);
    expect(isThemedBlankPreviewUrl('')).toBe(true);
    expect(isThemedBlankPreviewUrl('https://example.com')).toBe(false);
    expect(isThemedBlankPreviewUrl('/demo-preview.html')).toBe(false);
  });

  it('ships a color-scheme-aware empty document', () => {
    expect(THEMED_BLANK_PREVIEW_SRCDOC).toContain('color-scheme:light dark');
    expect(THEMED_BLANK_PREVIEW_SRCDOC).toContain('background:Canvas');
    expect(THEMED_BLANK_PREVIEW_SRCDOC).not.toContain('preview.example.com');
  });
});
