export type AgentHubColorScheme = 'light' | 'dark' | 'oled';

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
  };
  type: {
    xs: number;
    sm: number;
    base: number;
    lg: number;
    xl: number;
  };
  touch: {
    minimum: number;
    primary: number;
  };
  shadow: {
    panel: string;
  };
}

export const agentHubThemes = {
  dark: {
    scheme: 'dark',
    color: {
      canvas: '#1f1f27',
      surface: 'rgba(37, 37, 45, 0.92)',
      surfaceStrong: 'rgba(42, 42, 52, 0.96)',
      panel: 'rgba(31, 31, 39, 0.96)',
      tint: 'rgba(93, 104, 204, 0.14)',
      ink: '#e3e4e6',
      inkMuted: '#a0a1aa',
      inkSubtle: '#666875',
      line: 'rgba(255, 255, 255, 0.075)',
      focus: 'rgba(93, 104, 204, 0.42)',
      accent: '#5d68cc',
      accentSoft: 'rgba(93, 104, 204, 0.18)',
      moss: '#69c967',
      mossSoft: 'rgba(105, 201, 103, 0.14)',
      warning: '#d4aa4c',
      warningSoft: 'rgba(212, 170, 76, 0.14)',
      danger: '#ff7e78',
      dangerSoft: 'rgba(255, 126, 120, 0.14)',
    },
    radius: { control: 8, panel: 12, sheet: 16 },
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
    type: { xs: 12, sm: 13, base: 15, lg: 17, xl: 20 },
    touch: { minimum: 44, primary: 48 },
    shadow: { panel: '0 18px 48px rgba(0, 0, 0, 0.24)' },
  },
  light: {
    scheme: 'light',
    color: {
      canvas: '#f5f5f7',
      surface: 'rgba(255, 255, 255, 0.92)',
      surfaceStrong: '#ffffff',
      panel: 'rgba(255, 255, 255, 0.96)',
      tint: 'rgba(0, 113, 188, 0.08)',
      ink: '#171720',
      inkMuted: '#525463',
      inkSubtle: '#8a8d98',
      line: 'rgba(15, 23, 42, 0.1)',
      focus: 'rgba(0, 113, 188, 0.32)',
      accent: '#0071BC',
      accentSoft: 'rgba(0, 113, 188, 0.12)',
      moss: '#2f855a',
      mossSoft: 'rgba(47, 133, 90, 0.12)',
      warning: '#b7791f',
      warningSoft: 'rgba(183, 121, 31, 0.12)',
      danger: '#d92d30',
      dangerSoft: 'rgba(217, 45, 48, 0.12)',
    },
    radius: { control: 8, panel: 12, sheet: 16 },
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
    type: { xs: 12, sm: 13, base: 15, lg: 17, xl: 20 },
    touch: { minimum: 44, primary: 48 },
    shadow: { panel: '0 18px 42px rgba(15, 23, 42, 0.1)' },
  },
  oled: {
    scheme: 'oled',
    color: {
      canvas: '#000000',
      surface: '#0a0a0a',
      surfaceStrong: '#121212',
      panel: '#050505',
      tint: 'rgba(93, 104, 204, 0.16)',
      ink: '#e3e4e6',
      inkMuted: '#a0a1aa',
      inkSubtle: '#666875',
      line: 'rgba(255, 255, 255, 0.065)',
      focus: 'rgba(93, 104, 204, 0.42)',
      accent: '#5d68cc',
      accentSoft: 'rgba(93, 104, 204, 0.18)',
      moss: '#69c967',
      mossSoft: 'rgba(105, 201, 103, 0.14)',
      warning: '#d4aa4c',
      warningSoft: 'rgba(212, 170, 76, 0.14)',
      danger: '#ff7e78',
      dangerSoft: 'rgba(255, 126, 120, 0.14)',
    },
    radius: { control: 8, panel: 12, sheet: 16 },
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
    type: { xs: 12, sm: 13, base: 15, lg: 17, xl: 20 },
    touch: { minimum: 44, primary: 48 },
    shadow: { panel: 'none' },
  },
} as const satisfies Record<AgentHubColorScheme, AgentHubThemeTokens>;

export function getAgentHubTheme(mode: 'light' | 'dark' | 'oled' | 'system', systemDark: boolean): AgentHubThemeTokens {
  if (mode === 'system') {
    return systemDark ? agentHubThemes.dark : agentHubThemes.light;
  }

  return agentHubThemes[mode];
}
