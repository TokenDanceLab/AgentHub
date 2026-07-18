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

export const DESKTOP_GLASS_TOKEN_ALIASES = [
  {
    alias: '--td-canvas',
    intent: 'App canvas',
    desktopValue: '#1f1f27',
    webAlias: '--app-bg',
    mobileAlias: '--td-canvas',
  },
  {
    alias: '--td-surface',
    intent: 'Primary glass panel',
    desktopValue: 'rgba(37, 37, 45, 0.82)',
    webAlias: '--surface-raised',
    mobileAlias: '--td-surface',
  },
  {
    alias: '--td-panel',
    intent: 'Command-center panel',
    desktopValue: 'rgba(31, 31, 39, 0.9)',
    webAlias: '--sidebar-bg',
    mobileAlias: '--td-panel',
  },
  {
    alias: '--td-ink',
    intent: 'Primary text',
    desktopValue: '#e3e4e6',
    webAlias: '--foreground',
    mobileAlias: '--td-ink',
  },
  {
    alias: '--td-ink-muted',
    intent: 'Secondary readable text',
    desktopValue: '#a0a1aa',
    webAlias: '--muted-foreground',
    mobileAlias: '--td-ink-50',
  },
  {
    alias: '--td-line',
    intent: 'Glass hairline border',
    desktopValue: 'rgba(255, 255, 255, 0.075)',
    webAlias: '--border',
    mobileAlias: '--td-line',
  },
  {
    alias: '--td-plum',
    intent: 'Active/focus accent',
    desktopValue: '#5d68cc',
    webAlias: '--brand',
    mobileAlias: '--td-plum',
  },
  {
    alias: '--td-moss',
    intent: 'Success and reachable state',
    desktopValue: '#69c967',
    webAlias: '--success',
    mobileAlias: '--td-moss',
  },
  {
    alias: '--td-danger',
    intent: 'Destructive and offline state',
    desktopValue: '#ff7e78',
    webAlias: '--destructive',
    mobileAlias: '--td-danger',
  },
  {
    alias: '--td-radius-control',
    intent: 'Compact control radius',
    desktopValue: '8px',
    webAlias: '--radius-lg',
    mobileAlias: '--td-radius-control',
  },
  {
    alias: '--td-glass-blur',
    intent: 'Frosted glass blur radius',
    desktopValue: '28px',
    webAlias: '--glass-blur-lg',
    mobileAlias: '--td-glass-blur',
  },
  {
    alias: '--td-glass-card',
    intent: 'Frosted glass card fill',
    desktopValue: 'rgba(255, 255, 255, 0.72)',
    webAlias: '--glass-card-bg',
    mobileAlias: '--td-glass-card',
  },
  {
    alias: '--td-glass-elev',
    intent: 'Glass card elevation shadow',
    desktopValue: '0 10px 28px rgba(15, 23, 42, 0.08)',
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
] as const satisfies readonly DesignSurfaceRule[];

export function getGlassTokenAlias(alias: string): GlassTokenAlias | undefined {
  return DESKTOP_GLASS_TOKEN_ALIASES.find((token) => token.alias === alias);
}

export function getSurfaceRulesForPlatform(platform: DesignPlatform): DesignSurfaceRule[] {
  return DESKTOP_GLASS_SURFACE_RULES.filter((rule) =>
    (rule.appliesTo as readonly DesignPlatform[]).includes(platform),
  );
}
