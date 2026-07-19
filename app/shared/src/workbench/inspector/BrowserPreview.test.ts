import { describe, expect, it } from 'vitest';
import {
  THEMED_BLANK_PREVIEW_SRCDOC,
  THEMED_BLANK_PREVIEW_SRCDOC_DARK,
  THEMED_BLANK_PREVIEW_SRCDOC_LIGHT,
  buildThemedBlankPreviewSrcDoc,
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

  it('ships host-theme surfaces instead of system Canvas only', () => {
    const dark = buildThemedBlankPreviewSrcDoc('dark');
    const light = buildThemedBlankPreviewSrcDoc('light');

    expect(dark).toContain('color-scheme:dark');
    expect(dark).toContain('#1a1a20');
    expect(dark).not.toContain('background:Canvas');
    expect(dark).not.toContain('preview.example.com');

    expect(light).toContain('color-scheme:light');
    expect(light).toContain('#f8f9fb');
    expect(light).not.toContain('background:Canvas');

    expect(THEMED_BLANK_PREVIEW_SRCDOC_DARK).toBe(dark);
    expect(THEMED_BLANK_PREVIEW_SRCDOC_LIGHT).toBe(light);
    expect(THEMED_BLANK_PREVIEW_SRCDOC).toBe(light);
  });
});
