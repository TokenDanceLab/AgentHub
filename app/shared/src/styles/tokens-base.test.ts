import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const tokensPath = path.resolve(process.cwd(), '../shared/src/styles/tokens-base.css');
const themesPath = path.resolve(process.cwd(), '../shared/src/styles/themes.css');

function readCss(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('shared root CSS tokens', () => {
  it('does not lock app roots to a desktop-only minimum width', () => {
    const css = readCss(tokensPath);
    const bodyRule = css.match(/body\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';

    expect(bodyRule).toMatch(/\bmin-width\s*:\s*0\s*;/);
    expect(bodyRule).not.toMatch(/\bmin-width\s*:\s*1180px\s*;/);
  });

  it('enables OpenType legibility features on product roots (#1304)', () => {
    const css = readCss(tokensPath);
    expect(css).toMatch(/text-rendering:\s*optimizeLegibility/);
    expect(css).toMatch(/font-feature-settings:\s*"kern"\s*1,\s*"liga"\s*1/);
    expect(css).toMatch(/font-synthesis:\s*none/);
    expect(css).toMatch(/Noto Sans SC/);
  });

  it('uses fluid clamp headlines while keeping body/label fixed (#1305)', () => {
    const css = readCss(tokensPath);
    expect(css).toMatch(/--headline-lg:\s*700\s+clamp\(/);
    expect(css).toMatch(/--headline-md:\s*600\s+clamp\(/);
    expect(css).toMatch(/--body:\s*400\s+0\.875rem\/1\.5/);
    expect(css).toMatch(/--label:\s*500\s+0\.75rem\/1\.5/);
  });

  it('documents unified breakpoints and bumps root type on wide screens (#1309)', () => {
    const css = readCss(tokensPath);
    expect(css).toMatch(/--bp-narrow:\s*760px/);
    expect(css).toMatch(/@media\s*\(min-width:\s*1920px\)\s*\{\s*html\s*\{\s*font-size:\s*17px/);
    expect(css).toMatch(/@media\s*\(min-width:\s*2560px\)\s*\{\s*html\s*\{\s*font-size:\s*18px/);
  });

  it('defines high-DPI glass refinements at 2x (#1306 / #1307)', () => {
    const tokens = readCss(tokensPath);
    const themes = readCss(themesPath);
    expect(tokens).toMatch(/@media\s*\(-webkit-min-device-pixel-ratio:\s*2\),\s*\(min-resolution:\s*192dpi\)/);
    expect(tokens).toMatch(/--glass-blur-lg:\s*40px/);
    expect(themes).toMatch(/@media\s*\(-webkit-min-device-pixel-ratio:\s*2\),\s*\(min-resolution:\s*192dpi\)/);
    expect(themes).toMatch(/--glass-border:\s*rgba\(255,\s*255,\s*255,\s*0\.15\)/);
  });
});
