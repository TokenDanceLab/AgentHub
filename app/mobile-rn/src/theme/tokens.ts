import type { TextStyle, ViewStyle } from 'react-native';
import { DESKTOP_GLASS_TOKEN_ALIASES } from '@agenthub/shared/designTokens';

export type AgentHubColorScheme = 'light' | 'dark' | 'oled';
export type AgentHubFontWeight = '400' | '500' | '600';

const systemUiFont =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

/**
 * RN ↔ themes.css 对齐登记表（#1820）
 *
 * RN 无 CSS 变量可引用，本文件每个色值都绑定到 shared SSOT
 * `app/shared/src/styles/themes.css` 的语义槽位（--td-* 契约 + 扩展斜坡）。
 * 对齐规则：
 *  - 纯色槽位：值与 themes.css 解析值逐字一致（hex 及以上同源）。
 *  - 平台代理（登记为 intentional delta，不得擅自改动）：
 *      · surface/surfaceStrong/panel：基色取自 CSS 对应台阶，alpha 为 RN 玻璃
 *        代理（原生无 backdrop-filter，半透明叠底模拟 frost）。
 *      · oled：RN-only 子方案（无 CSS 对应主题），色相/状态色沿用 dark 语义，
 *        表面色为 OLED 省电调优（黑场）。
 *      · scrim：mobile-only 遮蔽（themes.css 无 --td-scrim 槽位）。
 *      · shadow：RN 原生阴影 API 代理 CSS --e-1/e-2/e-3（--td-shadow-*），
 *        shadowColor 对齐其 rgba 基色 #000000，opacity/radius/offset 为原生调优。
 */
// Desktop glass contract — derived from the cross-platform alias registry
// (shared/src/designTokens.ts) so the registry is a real product consumer,
// not a test-only file. RN has no CSS backdrop-filter; map blur/elev to the
// nearest elevation proxies.
const GLASS_ALIAS_TO_RN_PATH: Record<string, string> = {
  '--td-glass-blur': 'shadow.lg',
  '--td-glass-card': 'color.surface',
  '--td-glass-elev': 'shadow.md',
};

const mobileGlassAliases = Object.fromEntries(
  DESKTOP_GLASS_TOKEN_ALIASES.filter((token) => token.alias.startsWith('--td-glass-')).map(
    (token) => [token.alias, GLASS_ALIAS_TO_RN_PATH[token.alias] ?? 'shadow.md'],
  ),
) as Record<string, string>;

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
  // Desktop glass contract: derived from DESKTOP_GLASS_TOKEN_ALIASES above.
  ...mobileGlassAliases,
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
      canvas: '#1a1a20', // themes.css dark --app-bg（--td-canvas）
      surface: 'rgba(36, 36, 45, 0.92)', // --td-surface → --surface #24242d + RN 玻璃代理 alpha
      surfaceStrong: 'rgba(40, 40, 48, 0.96)', // --td-surface-2 → --surface-low #282830 + alpha
      panel: 'rgba(46, 46, 56, 0.96)', // --td-panel → --surface-high #2e2e38 + alpha
      tint: 'rgba(41, 171, 226, 0.08)', // --primary-light
      ink: '#e3e4e6', // --text-1（--td-ink）
      inkMuted: '#9a9aa4', // --text-2（--td-ink-muted）
      inkSubtle: '#83838d', // --text-3（--td-ink-subtle）
      line: 'rgba(255, 255, 255, 0.06)', // --bdr（--td-line）
      focus: 'rgba(41, 171, 226, 0.6)', // --ring（--td-brand-ring / --td-focus）
      accent: '#29ABE2', // --primary（--td-plum）
      accentSoft: 'rgba(41, 171, 226, 0.14)', // --primary-soft（--td-brand-soft）
      moss: '#69c967', // --success（--td-moss）
      mossSoft: 'rgba(105, 201, 103, 0.08)', // --success-bg
      warning: '#d4aa4c', // --warning（--td-warning）
      warningSoft: 'rgba(212, 170, 76, 0.08)', // --warning-bg
      danger: '#e87070', // --danger（--td-danger）
      dangerSoft: 'rgba(232, 112, 112, 0.06)', // --danger-bg
      onAccent: '#f4f5ff', // --primary-foreground（--td-ink-on-plum）
      onDanger: '#ffffff', // --destructive-foreground
      scrim: 'rgba(0, 0, 0, 0.48)', // 登记：mobile-only 遮蔽（CSS 无 --td-scrim）
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
      // shadowColor 对齐 --e-* rgba(0,0,0,…) 基色（#000000）；opacity/radius/offset 为原生调优代理。
      sm: { shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
      md: { shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
      lg: { shadowColor: '#000000', shadowOpacity: 0.24, shadowRadius: 48, shadowOffset: { width: 0, height: 18 }, elevation: 8 },
      panel: { shadowColor: '#000000', shadowOpacity: 0.24, shadowRadius: 48, shadowOffset: { width: 0, height: 18 }, elevation: 8 },
      hairline: { borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.06)' }, // --bdr（--td-line）
    },
  },
  light: {
    scheme: 'light',
    color: {
      canvas: '#f8f9fb', // themes.css light --app-bg（--td-canvas）
      surface: 'rgba(255, 255, 255, 0.92)', // --td-surface → --surface #ffffff + RN 玻璃代理 alpha
      surfaceStrong: '#ffffff', // 登记：RN 折叠表面台阶，取最强可用 = --surface
      panel: 'rgba(241, 243, 245, 0.96)', // --td-panel → --surface-high #f1f3f5 + alpha
      tint: 'rgba(0, 113, 188, 0.06)', // --primary-light
      ink: '#1a1a2e', // --text-1（--td-ink）
      inkMuted: '#585870', // --text-2（--td-ink-muted）
      inkSubtle: '#6a6a7c', // --text-3（--td-ink-subtle）
      line: 'rgba(0, 0, 0, 0.045)', // --bdr（--td-line）
      focus: 'rgba(0, 113, 188, 0.8)', // --ring（--td-brand-ring / --td-focus）
      accent: '#0071BC', // --primary（--td-plum）
      accentSoft: 'rgba(0, 113, 188, 0.11)', // --primary-soft（--td-brand-soft）
      moss: '#2d7a4f', // --success（--td-moss）
      mossSoft: 'rgba(45, 122, 79, 0.08)', // --success-bg
      warning: '#8a5a1a', // --warning（--td-warning）
      warningSoft: 'rgba(138, 90, 26, 0.08)', // --warning-bg
      danger: '#b03c3c', // --danger（--td-danger）
      dangerSoft: 'rgba(176, 60, 60, 0.06)', // --danger-bg
      onAccent: '#ffffff', // --primary-foreground（--td-ink-on-plum）
      onDanger: '#ffffff', // --destructive-foreground
      scrim: 'rgba(15, 23, 42, 0.36)', // 登记：mobile-only 遮蔽（CSS 无 --td-scrim）
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
      // shadowColor 对齐 --e-* rgba(0,0,0,…) 基色（#000000）；opacity/radius/offset 为原生调优代理。
      sm: { shadowColor: '#000000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
      md: { shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
      lg: { shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 42, shadowOffset: { width: 0, height: 18 }, elevation: 6 },
      panel: { shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 42, shadowOffset: { width: 0, height: 18 }, elevation: 6 },
      hairline: { borderWidth: 1, borderColor: 'rgba(0, 0, 0, 0.045)' }, // --bdr（--td-line）
    },
  },
  oled: {
    scheme: 'oled',
    color: {
      canvas: '#000000', // 登记：RN-only OLED 黑场子方案（无 CSS 对应主题），色相/状态色沿用 dark 语义
      surface: '#0a0a0a',
      surfaceStrong: '#121212',
      panel: '#050505',
      tint: 'rgba(41, 171, 226, 0.16)', // 登记：OLED 表面对比调优
      ink: '#e3e4e6', // --text-1
      inkMuted: '#9a9aa4', // --text-2
      inkSubtle: '#83838d', // --text-3
      line: 'rgba(255, 255, 255, 0.06)', // --bdr
      focus: 'rgba(41, 171, 226, 0.6)', // --ring
      accent: '#29ABE2', // --primary
      accentSoft: 'rgba(41, 171, 226, 0.14)', // --primary-soft
      moss: '#69c967', // --success
      mossSoft: 'rgba(105, 201, 103, 0.08)', // --success-bg
      warning: '#d4aa4c', // --warning
      warningSoft: 'rgba(212, 170, 76, 0.08)', // --warning-bg
      danger: '#e87070', // --danger
      dangerSoft: 'rgba(232, 112, 112, 0.06)', // --danger-bg
      onAccent: '#f4f5ff', // --primary-foreground
      onDanger: '#ffffff', // --destructive-foreground
      scrim: 'rgba(0, 0, 0, 0.58)', // 登记：mobile-only 遮蔽（OLED 加强）
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
      hairline: { borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.06)' }, // --bdr
    },
  },
} as const satisfies Record<AgentHubColorScheme, AgentHubThemeTokens>;

export function getAgentHubTheme(mode: 'light' | 'dark' | 'oled' | 'system', systemDark: boolean): AgentHubThemeTokens {
  if (mode === 'system') {
    return systemDark ? agentHubThemes.dark : agentHubThemes.light;
  }

  return agentHubThemes[mode];
}
