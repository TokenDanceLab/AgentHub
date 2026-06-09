import { describe, expect, it } from 'vitest';
import { DESKTOP_GLASS_TOKEN_ALIASES } from '../../../shared/src/designTokens';

import { agentHubMobileTokenAliases, agentHubThemes, getAgentHubTheme } from './tokens';

function resolvePath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => (
    typeof current === 'object' && current !== null && segment in current
      ? (current as Record<string, unknown>)[segment]
      : undefined
  ), source);
}

describe('AgentHub mobile tokens', () => {
  it('keeps light mode as the default white-first mobile surface', () => {
    expect(getAgentHubTheme('light', true)).toBe(agentHubThemes.light);
    expect(agentHubThemes.light.scheme).toBe('light');
    expect(agentHubThemes.light.color.canvas).toBe('#f7f8fa');
    expect(agentHubThemes.light.color.surfaceStrong).toBe('#ffffff');
  });

  it('keeps mobile touch targets at or above the design contract', () => {
    expect(agentHubThemes.light.touch.minimum).toBeGreaterThanOrEqual(44);
    expect(agentHubThemes.dark.touch.minimum).toBeGreaterThanOrEqual(44);
    expect(agentHubThemes.oled.touch.primary).toBeGreaterThanOrEqual(48);
  });

  it('uses AgentHub desktop-aligned dark glass values', () => {
    expect(agentHubThemes.dark.color.canvas).toBe('#1f1f27');
    expect(agentHubThemes.dark.color.ink).toBe('#e3e4e6');
    expect(agentHubThemes.dark.color.accent).toBe('#5d68cc');
  });

  it('maps every shared Desktop glass mobile alias to an RN token path', () => {
    const mappedAliases = Object.keys(agentHubMobileTokenAliases);

    expect(mappedAliases).toEqual(expect.arrayContaining(DESKTOP_GLASS_TOKEN_ALIASES.map((token) => token.mobileAlias)));
  });

  it('covers the TokenDance design contract aliases required by mobile surfaces', () => {
    expect(agentHubMobileTokenAliases).toMatchObject({
      '--td-canvas': 'color.canvas',
      '--td-surface': 'color.surface',
      '--td-tint': 'color.tint',
      '--td-panel': 'color.panel',
      '--td-ink': 'color.ink',
      '--td-ink-muted': 'color.inkMuted',
      '--td-line': 'color.line',
      '--td-plum': 'color.accent',
      '--td-moss': 'color.moss',
      '--td-danger': 'color.danger',
      '--td-warning': 'color.warning',
      '--td-focus': 'color.focus',
      '--td-scrim': 'color.scrim',
      '--td-on-accent': 'color.onAccent',
      '--td-on-danger': 'color.onDanger',
      '--td-radius-control': 'radius.control',
      '--td-radius-panel': 'radius.panel',
      '--td-space-1': 'space.xs',
      '--td-space-2': 'space.sm',
      '--td-space-3': 'space.md',
      '--td-space-4': 'space.lg',
      '--td-space-5': 'space.xl',
      '--td-space-6': 'space.xxl',
      '--td-space-7': 'space.xxxl',
      '--td-space-8': 'space.xxxxl',
      '--td-font': 'type.family.ui',
      '--td-mono': 'type.family.mono',
      '--td-text-xs': 'type.xs',
      '--td-text-sm': 'type.sm',
      '--td-text-base': 'type.base',
      '--td-text-lg': 'type.lg',
      '--td-text-xl': 'type.xl',
      '--td-leading-tight': 'type.lineHeight.xs',
      '--td-leading-normal': 'type.lineHeight.base',
      '--td-leading-relaxed': 'type.lineHeight.xl',
      '--td-shadow-sm': 'shadow.sm',
      '--td-shadow-md': 'shadow.md',
      '--td-shadow-lg': 'shadow.lg',
      '--td-shadow-panel': 'shadow.panel',
      '--td-shadow-hairline': 'shadow.hairline',
    });
  });

  it('resolves every mobile alias path in every theme', () => {
    for (const theme of Object.values(agentHubThemes)) {
      for (const [alias, path] of Object.entries(agentHubMobileTokenAliases)) {
        expect(resolvePath(theme, path), `${alias} -> ${path} in ${theme.scheme}`).not.toBeUndefined();
      }
    }
  });

  it('resolves system mode from the current scheme', () => {
    expect(getAgentHubTheme('system', true).scheme).toBe('dark');
    expect(getAgentHubTheme('system', false).scheme).toBe('light');
  });
});
