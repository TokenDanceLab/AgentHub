import type { TextStyle, ViewStyle } from 'react-native';

export type AgentHubColorScheme = 'light' | 'dark' | 'oled';
export type AgentHubFontWeight = '400' | '500' | '600';

const systemUiFont =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

export interface AgentHubTextRole extends Pick<TextStyle, 'fontSize' | 'fontWeight' | 'includeFontPadding' | 'lineHeight'> {
  fontSize: number;
  fontWeight: AgentHubFontWeight;
  includeFontPadding: false;
  lineHeight: number;
}

export interface AgentHubThemeTokens {
  scheme: AgentHubColorScheme;
  color: {
    canvas: string;
    surface: string;
    surfaceStrong: string;
    panel: string;
    tint: string;
    ink: string;
    inkMuted: string;
    inkSubtle: string;
    line: string;
    focus: string;
    accent: string;
    accentSoft: string;
    moss: string;
    mossSoft: string;
    warning: string;
    warningSoft: string;
    danger: string;
    dangerSoft: string;
    onAccent: string;
    onDanger: string;
    scrim: string;
  };
  radius: {
    control: number;
    panel: number;
    sheet: number;
  };
  space: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    xxxl: number;
    xxxxl: number;
  };
  type: {
    family: {
      ui?: string;
      mono?: string;
    };
    xs: number;
    sm: number;
    base: number;
    lg: number;
    xl: number;
    lineHeight: {
      xs: number;
      sm: number;
      base: number;
      lg: number;
      xl: number;
    };
    role: {
      caption: AgentHubTextRole;
      meta: AgentHubTextRole;
      body: AgentHubTextRole;
      rowTitle: AgentHubTextRole;
      screenTitle: AgentHubTextRole;
      profileName: AgentHubTextRole;
      tabLabel: AgentHubTextRole;
      badge: AgentHubTextRole;
      composer: AgentHubTextRole;
      metricValue: AgentHubTextRole;
    };
    weight: {
      regular: AgentHubFontWeight;
      medium: AgentHubFontWeight;
      semibold: AgentHubFontWeight;
    };
  };
  touch: {
    minimum: number;
    primary: number;
  };
  shadow: {
    sm: ViewStyle;
    md: ViewStyle;
    lg: ViewStyle;
    panel: ViewStyle;
    hairline: ViewStyle;
  };
}

export const agentHubMobileTokenAliases = {
  '--td-canvas': 'color.canvas',
  '--td-surface': 'color.surface',
  '--td-surface-2': 'color.surfaceStrong',
  '--td-surface-3': 'color.surfaceStrong', // RN 无第三台阶，取最强可用
  '--td-tint': 'color.tint',
  '--td-panel': 'color.panel',
  '--td-ink': 'color.ink',
  '--td-ink-50': 'color.inkMuted',
  '--td-ink-muted': 'color.inkMuted',
  '--td-ink-subtle': 'color.inkSubtle',
  '--td-ink-faint': 'color.inkSubtle', // RN 无 faint 档，取最近可读级
  '--td-line': 'color.line',
  '--td-line-strong': 'color.line', // RN 无 strong line，与 hairline 同源
  '--td-line-hover': 'color.line',
  '--td-plum': 'color.accent',
  '--td-plum-hover': 'color.accent', // RN 无 hover 概念，取 accent
  '--td-sky': 'color.accent',
  '--td-brand-soft': 'color.accentSoft',
  '--td-brand-ring': 'color.focus',
  '--td-ink-on-plum': 'color.onAccent',
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
  '--td-text-md': 'type.lg', // RN 无 md 档，16px 最近 type.lg
  '--td-text-lg': 'type.lg',
  '--td-text-xl': 'type.xl',
  '--td-text-caption': 'type.role.caption',
  '--td-text-meta': 'type.role.meta',
  '--td-text-body': 'type.role.body',
  '--td-text-row-title': 'type.role.rowTitle',
  '--td-text-screen-title': 'type.role.screenTitle',
  '--td-text-profile-name': 'type.role.profileName',
  '--td-text-tab-label': 'type.role.tabLabel',
  '--td-text-badge': 'type.role.badge',
  '--td-text-composer': 'type.role.composer',
  '--td-text-metric-value': 'type.role.metricValue',
  '--td-leading-tight': 'type.lineHeight.xs',
  '--td-leading-normal': 'type.lineHeight.base',
  '--td-leading-relaxed': 'type.lineHeight.xl',
  '--td-shadow-sm': 'shadow.sm',
  '--td-shadow-md': 'shadow.md',
  '--td-shadow-lg': 'shadow.lg',
  '--td-shadow-panel': 'shadow.panel',
  '--td-shadow-hairline': 'shadow.hairline',
  // Desktop glass contract (DESKTOP_GLASS_TOKEN_ALIASES).
  // RN has no CSS backdrop-filter; map blur/elev to nearest elevation proxies.
  '--td-glass-blur': 'shadow.lg',
  '--td-glass-card': 'color.surface',
  '--td-glass-elev': 'shadow.md',
} as const;

const semanticTypeRoles = {
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '400', includeFontPadding: false },
  meta: { fontSize: 12, lineHeight: 16, fontWeight: '400', includeFontPadding: false },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400', includeFontPadding: false },
  rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: '500', includeFontPadding: false },
  screenTitle: { fontSize: 17, lineHeight: 23, fontWeight: '500', includeFontPadding: false },
  profileName: { fontSize: 18, lineHeight: 24, fontWeight: '500', includeFontPadding: false },
  tabLabel: { fontSize: 11, lineHeight: 14, fontWeight: '400', includeFontPadding: false },
  badge: { fontSize: 11, lineHeight: 14, fontWeight: '500', includeFontPadding: false },
  composer: { fontSize: 15, lineHeight: 21, fontWeight: '400', includeFontPadding: false },
  metricValue: { fontSize: 20, lineHeight: 26, fontWeight: '500', includeFontPadding: false },
} as const satisfies AgentHubThemeTokens['type']['role'];

export const agentHubThemes = {
  dark: {
    scheme: 'dark',
    color: {
      canvas: '#1f1f27',
      surface: 'rgba(37, 37, 45, 0.92)',
      surfaceStrong: 'rgba(42, 42, 52, 0.96)',
      panel: 'rgba(31, 31, 39, 0.96)',
      tint: 'rgba(41, 171, 226, 0.14)',
      ink: '#e3e4e6',
      inkMuted: '#a0a1aa',
      inkSubtle: '#8a8d98',
      line: 'rgba(255, 255, 255, 0.075)',
      focus: 'rgba(41, 171, 226, 0.42)',
      accent: '#29ABE2',
      accentSoft: 'rgba(41, 171, 226, 0.18)',
      moss: '#69c967',
      mossSoft: 'rgba(105, 201, 103, 0.14)',
      warning: '#d4aa4c',
      warningSoft: 'rgba(212, 170, 76, 0.14)',
      danger: '#ff7e78',
      dangerSoft: 'rgba(255, 126, 120, 0.14)',
      onAccent: '#ffffff',
      onDanger: '#ffffff',
      scrim: 'rgba(0, 0, 0, 0.48)',
    },
    radius: { control: 8, panel: 10, sheet: 14 },
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40, xxxxl: 48 },
    type: {
      family: { ui: systemUiFont, mono: '"SF Mono", "Cascadia Code", Consolas, monospace' },
      xs: 12,
      sm: 13,
      base: 14,
      lg: 16,
      xl: 18,
      lineHeight: { xs: 16, sm: 18, base: 20, lg: 23, xl: 25 },
      role: semanticTypeRoles,
      weight: { regular: '400', medium: '500', semibold: '500' },
    },
    touch: { minimum: 44, primary: 48 },
    shadow: {
      sm: { shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
      md: { shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
      lg: { shadowColor: '#000000', shadowOpacity: 0.24, shadowRadius: 48, shadowOffset: { width: 0, height: 18 }, elevation: 8 },
      panel: { shadowColor: '#000000', shadowOpacity: 0.24, shadowRadius: 48, shadowOffset: { width: 0, height: 18 }, elevation: 8 },
      hairline: { borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.075)' },
    },
  },
  light: {
    scheme: 'light',
    color: {
      canvas: '#f7f8fa',
      surface: 'rgba(255, 255, 255, 0.92)',
      surfaceStrong: '#ffffff',
      panel: 'rgba(255, 255, 255, 0.96)',
      tint: 'rgba(0, 113, 188, 0.08)',
      ink: '#171720',
      inkMuted: '#525463',
      inkSubtle: '#6b6e78',
      line: 'rgba(15, 23, 42, 0.1)',
      focus: 'rgba(0, 113, 188, 0.32)',
      accent: '#0071BC',
      accentSoft: 'rgba(0, 113, 188, 0.12)',
      moss: '#2f855a',
      mossSoft: 'rgba(47, 133, 90, 0.12)',
      warning: '#b7791f',
      warningSoft: 'rgba(183, 121, 31, 0.08)',
      danger: '#d92d30',
      dangerSoft: 'rgba(217, 45, 48, 0.09)',
      onAccent: '#ffffff',
      onDanger: '#ffffff',
      scrim: 'rgba(15, 23, 42, 0.36)',
    },
    radius: { control: 8, panel: 10, sheet: 14 },
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40, xxxxl: 48 },
    type: {
      family: { ui: systemUiFont, mono: '"SF Mono", "Cascadia Code", Consolas, monospace' },
      xs: 12,
      sm: 13,
      base: 14,
      lg: 16,
      xl: 18,
      lineHeight: { xs: 16, sm: 18, base: 20, lg: 23, xl: 25 },
      role: semanticTypeRoles,
      weight: { regular: '400', medium: '500', semibold: '500' },
    },
    touch: { minimum: 44, primary: 48 },
    shadow: {
      sm: { shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
      md: { shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
      lg: { shadowColor: '#0f172a', shadowOpacity: 0.1, shadowRadius: 42, shadowOffset: { width: 0, height: 18 }, elevation: 6 },
      panel: { shadowColor: '#0f172a', shadowOpacity: 0.1, shadowRadius: 42, shadowOffset: { width: 0, height: 18 }, elevation: 6 },
      hairline: { borderWidth: 1, borderColor: 'rgba(15, 23, 42, 0.1)' },
    },
  },
  oled: {
    scheme: 'oled',
    color: {
      canvas: '#000000',
      surface: '#0a0a0a',
      surfaceStrong: '#121212',
      panel: '#050505',
      tint: 'rgba(41, 171, 226, 0.16)',
      ink: '#e3e4e6',
      inkMuted: '#a0a1aa',
      inkSubtle: '#8a8d98',
      line: 'rgba(255, 255, 255, 0.065)',
      focus: 'rgba(41, 171, 226, 0.42)',
      accent: '#29ABE2',
      accentSoft: 'rgba(41, 171, 226, 0.18)',
      moss: '#69c967',
      mossSoft: 'rgba(105, 201, 103, 0.14)',
      warning: '#d4aa4c',
      warningSoft: 'rgba(212, 170, 76, 0.14)',
      danger: '#ff7e78',
      dangerSoft: 'rgba(255, 126, 120, 0.14)',
      onAccent: '#ffffff',
      onDanger: '#ffffff',
      scrim: 'rgba(0, 0, 0, 0.58)',
    },
    radius: { control: 8, panel: 10, sheet: 14 },
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40, xxxxl: 48 },
    type: {
      family: { ui: systemUiFont, mono: '"SF Mono", "Cascadia Code", Consolas, monospace' },
      xs: 12,
      sm: 13,
      base: 14,
      lg: 16,
      xl: 18,
      lineHeight: { xs: 16, sm: 18, base: 20, lg: 23, xl: 25 },
      role: semanticTypeRoles,
      weight: { regular: '400', medium: '500', semibold: '500' },
    },
    touch: { minimum: 44, primary: 48 },
    shadow: {
      sm: {},
      md: {},
      lg: {},
      panel: {},
      hairline: { borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.065)' },
    },
  },
} as const satisfies Record<AgentHubColorScheme, AgentHubThemeTokens>;

export function getAgentHubTheme(mode: 'light' | 'dark' | 'oled' | 'system', systemDark: boolean): AgentHubThemeTokens {
  if (mode === 'system') {
    return systemDark ? agentHubThemes.dark : agentHubThemes.light;
  }

  return agentHubThemes[mode];
}
