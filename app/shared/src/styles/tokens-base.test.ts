import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('shared root CSS tokens', () => {
  it('does not lock app roots to a desktop-only minimum width', () => {
    const cssPath = path.resolve(process.cwd(), '../shared/src/styles/tokens-base.css');
    const css = readFileSync(cssPath, 'utf8');
    const bodyRule = css.match(/body\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';

    expect(bodyRule).toMatch(/\bmin-width\s*:\s*0\s*;/);
    expect(bodyRule).not.toMatch(/\bmin-width\s*:\s*1180px\s*;/);
  });
});
