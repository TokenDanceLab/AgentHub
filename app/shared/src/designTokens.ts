export type DesignPlatform = 'desktop' | 'web' | 'mobile';

export interface GlassTokenAlias {
  readonly alias: string;
  readonly intent: string;
  readonly desktopValue: string;
  readonly webAlias: string;
  readonly mobileAlias: string;
}

export interface DesignSurfaceRule {
  readonly id: string;
  readonly label: string;
  readonly appliesTo: readonly DesignPlatform[];
  readonly rule: string;
}

/**
 * Desktop glass token contract register（#1820 同步）。
 * desktopValue 列 = themes.css [data-theme='dark'] 解析值（dark 基线；
 * light 见各 webAlias 在 themes.css light 块中的定义）。
 */
export const DESKTOP_GLASS_TOKEN_ALIASES = [
  {
    alias: '--td-canvas',
    intent: 'App canvas',
    desktopValue: '#1a1a20',
    webAlias: '--td-canvas',
    mobileAlias: '--td-canvas',
  },
  {
    alias: '--td-surface',
    intent: 'Primary glass panel',
    desktopValue: '#24242d',
    webAlias: '--td-surface',
    mobileAlias: '--td-surface',
  },
  {
    alias: '--td-panel',
    intent: 'Command-center panel',
    desktopValue: '#2e2e38',
    webAlias: '--td-panel',
    mobileAlias: '--td-panel',
  },
  {
    alias: '--td-ink',
    intent: 'Primary text',
    desktopValue: '#e3e4e6',
    webAlias: '--td-ink',
    mobileAlias: '--td-ink',
  },
  {
    alias: '--td-ink-muted',
    intent: 'Secondary readable text',
    desktopValue: '#9a9aa4',
    webAlias: '--td-ink-muted',
    mobileAlias: '--td-ink-50',
  },
  {
    alias: '--td-line',
    intent: 'Glass hairline border',
    desktopValue: 'rgba(255, 255, 255, 0.06)',
    webAlias: '--td-line',
    mobileAlias: '--td-line',
  },
  {
    alias: '--td-plum',
    intent: 'Active/focus accent',
    desktopValue: '#29ABE2',
    webAlias: '--brand',
    mobileAlias: '--td-plum',
  },
  {
    alias: '--td-moss',
    intent: 'Success and reachable state',
    desktopValue: '#69c967',
    webAlias: '--td-moss',
    mobileAlias: '--td-moss',
  },
  {
    alias: '--td-danger',
    intent: 'Destructive and offline state',
    desktopValue: '#e87070',
    webAlias: '--td-danger',
    mobileAlias: '--td-danger',
  },
  {
    alias: '--td-radius-control',
    intent: 'Compact control radius',
    desktopValue: '8px',
    webAlias: '--r-sm',
    mobileAlias: '--td-radius-control',
  },
  {
    alias: '--td-glass-blur',
    intent: 'Frosted glass blur radius',
    desktopValue: '30px',
    webAlias: '--glass-blur-lg',
    mobileAlias: '--td-glass-blur',
  },
  {
    alias: '--td-glass-card',
    intent: 'Frosted glass card fill',
    desktopValue: 'rgba(30, 30, 38, 0.70)',
    webAlias: '--glass-card-bg',
    mobileAlias: '--td-glass-card',
  },
  {
    alias: '--td-glass-elev',
    intent: 'Glass card elevation shadow',
    desktopValue: '0 12px 36px rgba(0, 0, 0, 0.46)',
    webAlias: '--glass-elev-2',
    mobileAlias: '--td-glass-elev',
  },
] as const satisfies readonly GlassTokenAlias[];

export const DESKTOP_GLASS_SURFACE_RULES = [
  {
    id: 'no-gradient-surfaces',
    label: 'No gradient cards',
    appliesTo: ['web', 'mobile'],
    rule: 'Use rgba glass, borders, badges, and icons for hierarchy; do not use gradient cards or decorative gradients.',
  },
  {
    id: 'no-left-rails',
    label: 'No colored left rails',
    appliesTo: ['web', 'mobile'],
    rule: 'Use badges, icon tint, or full-row border color for status; do not use colored left strips or inset left shadows.',
  },
  {
    id: 'dense-operational-copy',
    label: 'Dense operational copy',
    appliesTo: ['desktop', 'web', 'mobile'],
    rule: 'Panels must show real state, metrics, or actions. Empty framed cards are treated as incomplete UI.',
  },
  {
    id: 'mobile-touch-targets',
    label: 'Mobile touch targets',
    appliesTo: ['mobile', 'web'],
    rule: 'Phone-width controls must keep at least 44px touch targets and avoid horizontal overflow.',
  },
  {
    id: 'frosted-glass-material',
    label: 'Frosted glass material',
    appliesTo: ['desktop', 'web', 'mobile'],
    rule: 'Glass cards use --glass-card-* + --glass-backdrop-filter tokens (white frosted light / translucent frosted dark). Prefer Card variant="glass" over raw rgba/blur hardcodes.',
  },
  {
    id: 'content-anchored',
    label: 'Content surfaces anchored',
    appliesTo: ['desktop', 'web', 'mobile'],
    rule: 'Message bubbles and inline content surfaces use --td-glass-content-* (fixed alpha, not frosted) and do NOT track the panel-level --glass-bg-* slider. Only chrome/panels track adjustable glass.',
  },
] as const satisfies readonly DesignSurfaceRule[];

export function getGlassTokenAlias(alias: string): GlassTokenAlias | undefined {
  return DESKTOP_GLASS_TOKEN_ALIASES.find((token) => token.alias === alias);
}

export function getSurfaceRulesForPlatform(platform: DesignPlatform): DesignSurfaceRule[] {
  return DESKTOP_GLASS_SURFACE_RULES.filter((rule) =>
    (rule.appliesTo as readonly DesignPlatform[]).includes(platform),
  );
}
