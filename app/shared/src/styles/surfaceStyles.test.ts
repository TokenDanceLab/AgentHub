import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const surfaces = [
  'desktop/src/styles/tokens.css',
  'desktop/src/styles/themes.css',
  'desktop/src/styles/presets.css',
  'web/src/styles/tokens.css',
  'web/src/styles/themes.css',
  'web/src/styles/presets.css',
];
const maxOverridesPerFile = 10;

function stripsComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe.each(surfaces)('%s', (surface) => {
  const css = stripsComments(readFileSync(path.join(appRoot, surface), 'utf8'));

  it('re-exports the shared design-token stylesheet', () => {
    expect(css).toMatch(/^\s*@import\s+['"]@shared\/styles\//m);
  });

  it('keeps platform overrides bounded and scoped', () => {
    const overrides = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].flatMap(([, selector, body]) => {
      const count = body.match(/^\s*--[A-Za-z][\w-]*\s*:/gm)?.length ?? 0;
      return count === 0 ? [] : [{ selector: selector.trim(), count }];
    });

    expect(overrides.reduce((total, override) => total + override.count, 0)).toBeLessThanOrEqual(
      maxOverridesPerFile,
    );
    expect(overrides.filter((override) => !override.selector.includes('[data-'))).toEqual([]);
  });
});
