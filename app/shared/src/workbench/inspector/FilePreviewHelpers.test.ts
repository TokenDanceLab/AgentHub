import { describe, expect, it } from 'vitest';
import {
  defaultPreviewMode,
  diffLineClass,
  fileTypeLabel,
  highlightDiffLine,
  isHtmlFile,
  isImageFile,
  isMarkdownFile,
  isPdfFile,
  isTextFile,
  nativeModeLabel,
  openWithIconClass,
  openWithItems,
  resolveNativeMode,
  syntheticDiff,
} from './FilePreviewHelpers';
import styles from './FilePreview.module.css';

describe('FilePreviewHelpers', () => {
  it('derives file type labels from language or extension', () => {
    expect(fileTypeLabel('a.ts', 'typescript')).toBe('TYPESCRIPT');
    expect(fileTypeLabel('readme.md')).toBe('MD');
    expect(fileTypeLabel('Makefile')).toBe('file');
  });

  it('detects mime-ish families by extension', () => {
    expect(isPdfFile('spec.pdf')).toBe(true);
    expect(isHtmlFile('index.htm')).toBe(true);
    expect(isImageFile('shot.PNG')).toBe(true);
    expect(isTextFile('notes.csv')).toBe(true);
    expect(isMarkdownFile('handoff.mdx')).toBe(true);
    expect(isPdfFile('shot.png')).toBe(false);
  });

  it('plans default and native preview modes', () => {
    expect(defaultPreviewMode('doc.pdf')).toBe('pdf');
    expect(defaultPreviewMode('page.html')).toBe('html');
    expect(defaultPreviewMode('pic.png')).toBe('image');
    expect(defaultPreviewMode('log.txt')).toBe('text');
    expect(defaultPreviewMode('notes.md')).toBe('markdown');
    expect(defaultPreviewMode('main.ts')).toBe('code');

    expect(resolveNativeMode('doc.pdf')).toBe('pdf');
    expect(resolveNativeMode('main.ts')).toBeNull();
    expect(nativeModeLabel('pdf')).toBe('PDF');
    expect(nativeModeLabel('image')).toBe('图片');
    expect(nativeModeLabel('text')).toBe('文本');
  });

  it('builds synthetic readonly diffs with first lines marked added', () => {
    const diff = syntheticDiff('a.ts', 'one\ntwo\nthree\nfour');
    expect(diff).toContain('diff --git a/a.ts b/a.ts');
    expect(diff).toContain('+one');
    expect(diff).toContain('+two');
    expect(diff).toContain('+three');
    expect(diff).toContain(' four');
  });

  it('classifies diff lines for add/delete styling', () => {
    expect(diffLineClass('+added', styles)).toBe(styles.diffAdd ?? '');
    expect(diffLineClass('-removed', styles)).toBe(styles.diffDel ?? '');
    expect(diffLineClass('+++ header', styles)).toBe('');
    expect(diffLineClass(' context', styles)).toBe('');
  });

  it('highlights diff markers separately from body', () => {
    const highlighted = highlightDiffLine('+const x = 1', 'typescript');
    expect(highlighted.length).toBeGreaterThan(0);
    expect(highlightDiffLine('@@ hunk @@', 'typescript')).toBeTruthy();
    expect(highlightDiffLine('diff --git a/x b/x', '')).toBeTruthy();
  });

  it('keeps open-with catalog and icon class mapping stable', () => {
    expect(openWithItems.length).toBeGreaterThanOrEqual(8);
    expect(openWithItems.some((item) => item.icon === 'vscode')).toBe(true);
    expect(openWithIconClass('defaultApp')).toContain(styles.vendorDefault ?? 'vendorDefault');
    expect(openWithIconClass('terminal')).toContain(styles.vendorTerminal ?? 'vendorTerminal');
    expect(openWithIconClass('folder')).toContain(styles.vendorFolder ?? 'vendorFolder');
    expect(openWithIconClass('vscode')).toBeTruthy();
  });
});
