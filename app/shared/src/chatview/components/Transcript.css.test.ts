import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const pinnedClassNames = [
  'chatview',
  'transcript',
  'chatview-pinned-wrap',
  'chatview-pinned-banner',
  'chatview-pinned-mark',
  'chatview-pinned-copy',
  'chatview-pinned-line',
  'chatview-pinned-btn',
  'chatview-pinned-dismiss',
  'chatview-pinned-meta',
  'chatview-pinned-time',
] as const;

const messageDisplayMetaClassNames = [
  'message-display-meta',
  'message-display-meta-line',
  'message-display-title',
  'message-display-badge',
  'message-display-detail',
] as const;

function cssRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? '';
}

describe('ChatViewTranscript CSS contract', () => {
  it('keeps pinned announcement classes styled', () => {
    const cssPath = path.resolve(process.cwd(), '../shared/src/chatview/components/Transcript.css');
    const css = readFileSync(cssPath, 'utf8');

    for (const className of pinnedClassNames) {
      expect(css, className).toMatch(new RegExp(`\\.${className}\\b`));
    }
  });

  it('keeps agent markdown replies on a stable readable column', () => {
    const cssPath = path.resolve(process.cwd(), '../shared/src/chatview/components/Transcript.css');
    const css = readFileSync(cssPath, 'utf8');
    const groupRule = cssRule(css, '.bubble-group');
    const nestedBubbleRule = cssRule(css, '.bubble-group > .agent-bubble');

    expect(groupRule).not.toMatch(/\bwidth\s*:\s*fit-content\b/);
    expect(groupRule).toMatch(/\bwidth\s*:\s*min\(86%,\s*820px\)/);
    expect(nestedBubbleRule).toMatch(/\bwidth\s*:\s*100%/);
  });

  it('keeps the ChatView root constrained so the transcript owns vertical scrolling', () => {
    const cssPath = path.resolve(process.cwd(), '../shared/src/chatview/components/Transcript.css');
    const css = readFileSync(cssPath, 'utf8');
    const chatviewRule = cssRule(css, '.chatview');

    expect(chatviewRule).toMatch(/\bdisplay\s*:\s*flex\b/);
    expect(chatviewRule).toMatch(/\bflex-direction\s*:\s*column\b/);
    expect(chatviewRule).toMatch(/\bflex\s*:\s*1\s+1\s+auto\b/);
    expect(chatviewRule).toMatch(/\bmin-height\s*:\s*0\b/);
    expect(chatviewRule).toMatch(/\boverflow\s*:\s*hidden\b/);
  });

  it('keeps Hub message metadata styled as compact non-card chrome', () => {
    const cssPath = path.resolve(process.cwd(), '../shared/src/chatview/components/Transcript.css');
    const css = readFileSync(cssPath, 'utf8');
    const metaRule = cssRule(css, '.message-display-meta');
    const detailRule = cssRule(css, '.message-display-detail');

    for (const className of messageDisplayMetaClassNames) {
      expect(css, className).toMatch(new RegExp(`\\.${className}\\b`));
    }
    expect(metaRule).toMatch(/\bfont\s*:\s*var\(--label-xs\)/);
    expect(metaRule).not.toMatch(/\bbackground\s*:/);
    expect(detailRule).toMatch(/\btext-overflow\s*:\s*ellipsis/);
  });

  it('keeps card stack radii on the outer rows without nesting preview cards', () => {
    const transcriptCssPath = path.resolve(process.cwd(), '../shared/src/chatview/components/Transcript.css');
    const rowItemCssPath = path.resolve(process.cwd(), '../shared/src/chatview/components/RowItem.css');
    const transcriptCss = readFileSync(transcriptCssPath, 'utf8');
    const rowItemCss = readFileSync(rowItemCssPath, 'utf8');
    const stackRule = cssRule(transcriptCss, '.card-stack');
    const stackedRowRule = cssRule(rowItemCss, '.card-stack > .row-item');
    const stackedSiblingRule = cssRule(rowItemCss, '.card-stack > .row-item + .row-item');
    const firstRule = cssRule(rowItemCss, '.card-stack > .row-item:first-child');
    const lastRule = cssRule(rowItemCss, '.card-stack > .row-item:last-child');
    const onlyRule = cssRule(rowItemCss, '.card-stack > .row-item:only-child');
    const previewRule = cssRule(rowItemCss, '.preview-card');

    expect(stackRule).toMatch(/\bgap\s*:\s*0\b/);
    expect(stackedRowRule).toMatch(/\bwidth\s*:\s*100%/);
    expect(stackedRowRule).toMatch(/\bborder-radius\s*:\s*0\b/);
    expect(stackedSiblingRule).toMatch(/\bborder-top\s*:\s*none\b/);
    expect(stackedSiblingRule).toMatch(/\bmargin-top\s*:\s*-1px\b/);
    expect(firstRule).toMatch(/\bborder-radius\s*:\s*var\(--r-md\)\s+var\(--r-md\)\s+0\s+0\b/);
    expect(lastRule).toMatch(/\bborder-radius\s*:\s*0\s+0\s+var\(--r-md\)\s+var\(--r-md\)/);
    expect(onlyRule).toMatch(/\bborder-radius\s*:\s*var\(--r-md\)/);
    expect(previewRule).toMatch(/\bborder\s*:\s*0\b/);
    expect(previewRule).toMatch(/\bborder-radius\s*:\s*0\b/);
    expect(previewRule).toMatch(/\bbackground\s*:\s*transparent\b/);
    expect(previewRule).toMatch(/\bmargin\s*:\s*0\b/);
  });
});
