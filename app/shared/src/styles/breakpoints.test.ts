import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BREAKPOINTS, maxWidthQuery, minWidthQuery } from './breakpoints';

/* ═══════════════════════════════════════════════════════════════════
   breakpoints — SSOT cross-check (#1827).

   The JS table and the tokens-base.css "Responsive Breakpoints" comment
   copy must both change in one commit; this suite makes a value drift a
   test failure instead of a silent two-SSOT divergence.
   ═══════════════════════════════════════════════════════════════════ */

const stylesDir = path.dirname(fileURLToPath(import.meta.url));
const tokensPath = path.resolve(stylesDir, 'tokens-base.css');

describe('breakpoints SSOT', () => {
  it('keeps the JS table in sync with the tokens-base.css documentation copy', () => {
    const css = readFileSync(tokensPath, 'utf8');
    for (const [key, value] of Object.entries(BREAKPOINTS)) {
      const valueText = css.match(new RegExp(`--bp-${key}:\\s*(\\d+)px`))?.[1];
      expect(valueText, `tokens-base.css must document --bp-${key} (${value}px)`).toBeDefined();
      expect(Number(valueText)).toBe(value);
    }
  });

  it('ships the canonical mobile/narrow values and the mid-range strategy set', () => {
    expect(BREAKPOINTS).toEqual({
      mobile: 480,
      narrow: 768,
      medium: 1024,
      standard: 1280,
      wide: 1440,
      xwide: 1920,
      ultra: 2560,
    });
  });

  it('builds integer max-width queries for the compact tiers', () => {
    expect(maxWidthQuery('mobile')).toBe('(max-width: 480px)');
    expect(maxWidthQuery('narrow')).toBe('(max-width: 768px)');
  });

  it('builds min-width queries for the desktop tiers', () => {
    expect(minWidthQuery('medium')).toBe('(min-width: 1024px)');
    expect(minWidthQuery('standard')).toBe('(min-width: 1280px)');
    expect(minWidthQuery('wide')).toBe('(min-width: 1440px)');
    expect(minWidthQuery('xwide')).toBe('(min-width: 1920px)');
    expect(minWidthQuery('ultra')).toBe('(min-width: 2560px)');
  });
});
