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

  it('keeps the ChatView root constrained so the transcript owns vertical scrolling', () => {
    const chatviewRule = cssRule(css, '.chatview');

    expect(chatviewRule).toMatch(/\bdisplay\s*:\s*flex\b/);
    expect(chatviewRule).toMatch(/\bflex-direction\s*:\s*column\b/);
    expect(chatviewRule).toMatch(/\bflex\s*:\s*1\s+1\s+auto\b/);
    expect(chatviewRule).toMatch(/\bmin-height\s*:\s*0\b/);
    expect(chatviewRule).toMatch(/\boverflow\s*:\s*hidden\b/);
  });

  it('keeps Hub message metadata styled as compact non-card chrome', () => {
    for (const className of messageDisplayMetaClassNames) {
      expect(css, className).toMatch(new RegExp(`\\.${className}\\b`));
    }
  });

  it('keeps both message roles on the shared conversation column', () => {
    expect(css).toMatch(/\.agent-row\s*,\s*\.user-row-right\s*\{/);
    expect(css).toMatch(/\.user-row-right\s*\{[^}]*justify-content\s*:\s*flex-end/);
  });
});
