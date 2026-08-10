import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'Transcript.css');
const css = readFileSync(cssPath, 'utf8');

const pinnedClassNames = [
  'chatview',
  'transcript',
  'chatview-pinned-wrap',
  'chatview-pinned-banner',
  'chatview-pinned-mark',
  'chatview-pinned-copy',
  'chatview-pinned-line',
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
    for (const className of pinnedClassNames) {
      expect(css, className).toMatch(new RegExp(`\\.${className}\\b`));
    }
  });

  it('keeps agent markdown replies on a stable readable column', () => {
    const groupRule = cssRule(css, '.bubble-group');
    const nestedBubbleRule = cssRule(css, '.bubble-group > .agent-bubble');

    expect(groupRule).not.toMatch(/\bwidth\s*:\s*fit-content\b/);
    expect(groupRule).toMatch(/\bwidth\s*:\s*min\(86%,\s*820px\)/);
    expect(nestedBubbleRule).toMatch(/\bwidth\s*:\s*100%/);
  });

  it('keeps the ChatView root constrained so the transcript owns vertical scrolling', () => {
    const chatviewRule = cssRule(css, '.chatview');

    expect(chatviewRule).toMatch(/\bdisplay\s*:\s*flex\b/);
    expect(chatviewRule).toMatch(/\bflex-direction\s*:\s*column\b/);
    expect(chatviewRule).toMatch(/\bflex\s*:\s*1\s+1\s+auto\b/);
    expect(chatviewRule).toMatch(/\bmin-height\s*:\s*0\b/);
    expect(chatviewRule).toMatch(/\boverflow\s*:\s*hidden\b/);
  });

  it('keeps Hub message metadata styled as compact non-card chrome', () => {
    const metaRule = cssRule(css, '.message-display-meta');
    const detailRule = cssRule(css, '.message-display-detail');

    for (const className of messageDisplayMetaClassNames) {
      expect(css, className).toMatch(new RegExp(`\\.${className}\\b`));
    }
    expect(metaRule).toMatch(/\bfont\s*:\s*var\(--label-xs\)/);
    expect(metaRule).not.toMatch(/\bbackground\s*:/);
    expect(detailRule).toMatch(/\btext-overflow\s*:\s*ellipsis/);
  });

  it('uses dense row rhythm tokens for transcript messages (P76 #1311)', () => {
    const rowRule = cssRule(css, '.grp-row');
    const contentRule = cssRule(css, '.grp-content');

    expect(rowRule).toMatch(/margin-bottom\s*:\s*var\(--sp-md\)/);
    expect(rowRule).toMatch(/gap\s*:\s*var\(--sp-sm\)/);
    expect(contentRule).toMatch(/gap\s*:\s*var\(--sp-2\)/);
    /* Full-file match: cssRule hits first `.user-bubble` under `.grp-content >` (align only). */
    expect(css).toMatch(/\.user-bubble\s*\{[^}]*padding\s*:\s*var\(--sp-xxs\)\s+var\(--sp-sm\)/);
    expect(css).toMatch(/\.agent-bubble\s*\{[^}]*padding\s*:\s*var\(--sp-xxs\)\s+var\(--sp-sm\)/);
  });
});
