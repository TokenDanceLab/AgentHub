import type { Preview } from '@storybook/react';
import '../src/styles/tokens.css';
import '../src/styles/themes.css';
import '../src/styles/presets.css';

// Preset list must stay in sync with app/shared/src/themePresets.ts
// (THEME_PRESETS) and app/shared/src/styles/presets-base.css selectors.
const THEME_PRESETS = [
  'classic-blue',
  'claude-warm',
  'chatgpt-minimal',
  'deepseek-tech',
  'one-dark-pro',
  'dracula',
] as const;

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'AgentHub theme mode (data-theme)',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
      },
    },
    themePreset: {
      description: 'AgentHub theme preset (data-theme-preset)',
      toolbar: {
        title: 'Preset',
        icon: 'paintbrush',
        items: [
          { value: 'default', title: 'Default' },
          ...THEME_PRESETS.map((preset) => ({ value: preset, title: preset })),
        ],
      },
    },
  },
  initialGlobals: {
    theme: 'dark',
    themePreset: 'default',
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // Aligned to shared themes.css app-bg values (dark #1a1a20 / light
    // #f8f9fb) so the canvas color matches the real theme surface.
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#1a1a20' },
        { name: 'light', value: '#f8f9fb' },
      ],
    },
  },
  decorators: [
    (Story, context) => {
      const { theme, themePreset } = context.globals as {
        theme?: unknown;
        themePreset?: unknown;
      };
      const root = document.documentElement;
      // Apply toolbar-chosen theme/preset onto <html> so stories render with
      // the real theme tokens (themes.css / presets-base.css) instead of the
      // default light theme. Re-applied on every render, then React takes over
      // via ThemeContext in the app shell stories.
      if (theme === 'dark' || theme === 'light') {
        root.setAttribute('data-theme', theme);
        root.style.colorScheme = theme;
      }
      if (
        typeof themePreset === 'string' &&
        themePreset !== 'default' &&
        (THEME_PRESETS as readonly string[]).includes(themePreset)
      ) {
        root.setAttribute('data-theme-preset', themePreset);
      } else {
        root.removeAttribute('data-theme-preset');
      }
      return (
        <div style={{ padding: '2rem', fontFamily: 'var(--font-sans, sans-serif)' }}>
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
