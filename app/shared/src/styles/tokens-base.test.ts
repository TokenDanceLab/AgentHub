import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESKTOP_GLASS_TOKEN_ALIASES } from '../designTokens';
import { THEME_PRESETS } from '../themePresets';

const stylesDir = path.dirname(fileURLToPath(import.meta.url));
const tokensPath = path.resolve(stylesDir, 'tokens-base.css');
const themesPath = path.resolve(stylesDir, 'themes.css');
const presetsPath = path.resolve(stylesDir, 'presets-base.css');

function readCss(p: string): string {
  return readFileSync(p, 'utf8');
}

const RADIUS_SCALE = new Set(['6px', '8px', '12px', '16px', '22px', '24px', '9999px']);
const SPACING_SCALE = new Set(['2px', '4px', '6px', '8px', '10px', '14px', '16px', '24px', '32px']);
const PRESET_V4_TOKENS = [
  '--surface:',
  '--surface-dim:',
  '--surface-high:',
  '--text-1:',
  '--text-2:',
  '--bdr:',
  '--primary-hover:',
];

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

  it('documents unified breakpoints and bumps root type on wide screens (#1309 / #1827)', () => {
    const css = readCss(tokensPath);
    // #1827: 760/767/768 normalized to the canonical narrow tier 768px.
    expect(css).toMatch(/--bp-narrow:\s*768px/);
    expect(css).toMatch(/--bp-standard:\s*1280px/);
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

  it('keeps the v4 radius scale on the approved step set', () => {
    const css = readCss(tokensPath);
    const radiusTokens = css.matchAll(/--r-(?:xs|sm|md|lg|xl|2xl|full):\s*([^;]+);/g);
    const values = [...radiusTokens].map((match) => match[1].trim());

    expect(values.length).toBeGreaterThanOrEqual(7);
    for (const value of values) {
      expect(RADIUS_SCALE.has(value)).toBe(true);
    }
  });

  it('keeps the v4 spacing scale on the approved step set', () => {
    const css = readCss(tokensPath);
    const spacingTokens = css.matchAll(/--sp-(?:xs|sm|md|lg|xl|xxs|2|10|14|16):\s*([^;]+);/g);
    const values = [...spacingTokens].map((match) => match[1].trim());

    expect(values.length).toBeGreaterThanOrEqual(10);
    for (const value of values) {
      expect(SPACING_SCALE.has(value)).toBe(true);
    }
  });

  it('covers every preset light/dark variant with the v4 main tokens', () => {
    const presets = readCss(presetsPath);
    const darkVariant = `:not\\(\\[data-theme='light'\\]\\)`;
    const lightVariant = `\\[data-theme='light'\\]`;

    for (const preset of THEME_PRESETS) {
      for (const variant of [darkVariant, lightVariant]) {
        const selectorPattern = `\\[data-theme-preset='${preset}'\\]${variant}`;
        const block = presets.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
        const readableSelector = `[data-theme-preset='${preset}']${variant.replaceAll('\\', '')}`;

        expect(block, `${readableSelector} block missing`).toBeTruthy();
        for (const token of PRESET_V4_TOKENS) {
          expect(block, `${readableSelector} must declare ${token}`).toContain(token);
        }
      }
    }
  });

  it('keeps the JS glass-token SSOT in sync with themes.css values', () => {
    const themes = readCss(themesPath);
    const darkBlock = themes.match(/\[data-theme='dark'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    const lightBlock =
      themes.match(/:root:not\(\[data-theme='dark'\]\),\s*\[data-theme='light'\]\s*\{([^}]*)\}/)?.[1] ?? '';

    const plum = DESKTOP_GLASS_TOKEN_ALIASES.find((token) => token.alias === '--td-plum');
    const radiusControl = DESKTOP_GLASS_TOKEN_ALIASES.find((token) => token.alias === '--td-radius-control');

    expect(plum?.desktopValue).toBe('#29ABE2');
    expect(darkBlock).toMatch(/--primary:\s*#29ABE2/);
    expect(lightBlock).toMatch(/--primary:\s*#0071BC/);

    expect(radiusControl?.webAlias).toBe('--r-sm');
    expect(readCss(tokensPath)).toMatch(/--r-sm:\s*8px/);
    expect(darkBlock).toMatch(/--td-radius-control:\s*var\(--r-sm\)/);
    expect(lightBlock).toMatch(/--td-radius-control:\s*var\(--r-sm\)/);
  });

  it('defines the five-tier opacity de-emphasis scale (#1827)', () => {
    const css = readCss(tokensPath);
    expect(css).toMatch(/--opacity-30:\s*0\.3;/);
    expect(css).toMatch(/--opacity-40:\s*0\.4;/);
    expect(css).toMatch(/--opacity-50:\s*0\.5;/);
    expect(css).toMatch(/--opacity-65:\s*0\.65;/);
    expect(css).toMatch(/--opacity-85:\s*0\.85;/);
  });

  it('theme-pairs --state-* for WCAG AA body text (#1827)', () => {
    const base = readCss(tokensPath);
    const themes = readCss(themesPath);
    // State colors are theme-sensitive (light AA pairs vs dark status pairs);
    // a single fixed hex cannot pass 4.5:1 on both #f8f9fb and #1a1a20.
    expect(base).not.toMatch(/--state-running:/);
    const darkBlock = themes.match(/\[data-theme='dark'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    const lightBlock =
      themes.match(/:root:not\(\[data-theme='dark'\]\),\s*\[data-theme='light'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    for (const block of [darkBlock, lightBlock]) {
      expect(block).toMatch(/--state-running:\s*var\(--info\);/);
      expect(block).toMatch(/--state-thinking:\s*var\(--info\);/);
      expect(block).toMatch(/--state-waiting:\s*var\(--warning\);/);
      expect(block).toMatch(/--state-success:\s*var\(--success\);/);
      expect(block).toMatch(/--state-failed:\s*var\(--danger\);/);
      expect(block).toMatch(/--state-error:\s*var\(--state-failed\);/);
    }
  });

  it('declares the --td-* status companions in both themes (#1827)', () => {
    const themes = readCss(themesPath);
    expect(themes).toMatch(/--td-info:\s*var\(--info\);/);
    expect(themes).toMatch(/--td-info-bg:\s*var\(--info-bg\);/);
    expect(themes).toMatch(/--td-moss-bg:\s*var\(--success-bg\);/);
    expect(themes).toMatch(/--td-warning-bg:\s*var\(--warning-bg\);/);
    expect(themes).toMatch(/--td-danger-bg:\s*var\(--danger-bg\);/);
    expect((themes.match(/--td-info:\s*var\(--info\);/g) ?? []).length).toBe(2);
  });

  it('removes the zero-consumer --run-* and --tool-* families (#1827)', () => {
    const themes = readCss(themesPath);
    expect(themes).not.toMatch(/--run-queued:|--run-starting:|--run-failed:/);
    expect(themes).not.toMatch(/--tool-edit:|--tool-bash:|--tool-read:/);
  });

  it('covers danger/state/focus families in every preset variant (#1827)', () => {
    const presets = readCss(presetsPath);
    const darkVariant = `:not\\(\\[data-theme='light'\\]\\)`;
    const lightVariant = `\\[data-theme='light'\\]`;
    for (const preset of THEME_PRESETS) {
      for (const variant of [darkVariant, lightVariant]) {
        const selectorPattern = `\\[data-theme-preset='${preset}'\\]${variant}`;
        const block = presets.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
        for (const decl of ['--danger:', '--danger-bg:', '--state-running:', '--state-failed:',
                            '--role-orchestrator:', '--bdr-focus:', '--glass-tint-plum:']) {
          expect(block, `${preset}${variant} must declare ${decl}`).toContain(decl);
        }
      }
    }
  });
});
