import { describe, expect, it } from 'vitest';
import {
  DESKTOP_GLASS_SURFACE_RULES,
  DESKTOP_GLASS_TOKEN_ALIASES,
  getGlassTokenAlias,
  getSurfaceRulesForPlatform,
} from './designTokens';

describe('designTokens', () => {
  it('keeps Web and Mobile mapped to the Desktop glass baseline aliases', () => {
    const aliases = DESKTOP_GLASS_TOKEN_ALIASES.map((token) => token.alias);

    expect(aliases).toEqual([
      '--td-canvas',
      '--td-surface',
      '--td-panel',
      '--td-ink',
      '--td-ink-muted',
      '--td-line',
      '--td-plum',
      '--td-moss',
      '--td-danger',
      '--td-radius-control',
      '--td-glass-blur',
      '--td-glass-card',
      '--td-glass-elev',
    ]);

    for (const token of DESKTOP_GLASS_TOKEN_ALIASES) {
      expect(token.desktopValue).toBeTruthy();
      expect(token.webAlias).toMatch(/^--/);
      expect(token.mobileAlias).toMatch(/^--/);
    }
  });

  it('keeps the visual hygiene rules explicit for non-Desktop clients', () => {
    expect(DESKTOP_GLASS_SURFACE_RULES.map((rule) => rule.id)).toEqual([
      'no-gradient-surfaces',
      'no-left-rails',
      'dense-operational-copy',
      'mobile-touch-targets',
      'frosted-glass-material',
      'content-anchored',
    ]);

    expect(getSurfaceRulesForPlatform('web').map((rule) => rule.id)).toContain('no-gradient-surfaces');
    expect(getSurfaceRulesForPlatform('mobile').map((rule) => rule.id)).toContain('no-left-rails');
    expect(getSurfaceRulesForPlatform('desktop').map((rule) => rule.id)).toEqual([
      'dense-operational-copy',
      'frosted-glass-material',
      'content-anchored',
    ]);
  });

  it('looks up individual aliases without embedding app-specific copies', () => {
    expect(getGlassTokenAlias('--td-plum')).toMatchObject({
      intent: 'Active/focus accent',
      desktopValue: '#29ABE2',
      webAlias: '--brand',
      mobileAlias: '--td-plum',
    });
    expect(getGlassTokenAlias('--td-radius-control')).toMatchObject({
      intent: 'Compact control radius',
      desktopValue: '8px',
      webAlias: '--r-sm',
      mobileAlias: '--td-radius-control',
    });
    expect(getGlassTokenAlias('--td-glass-blur')).toMatchObject({
      intent: 'Frosted glass blur radius',
      webAlias: '--glass-blur-lg',
    });
    expect(getGlassTokenAlias('--unknown')).toBeUndefined();
  });
});
