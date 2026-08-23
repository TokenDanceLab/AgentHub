/*
 * AgentHub Desktop theme pre-bootstrap (#1827).
 *
 * Sets data-theme / data-theme-preset on <html> before first paint so the
 * app does not flash the default theme when the stored mode/preset differs.
 * This is a classic (non-module) script on purpose: the packaged Tauri CSP is
 * `script-src 'self'`, which blocks inline scripts — so the bootstrap must
 * live in a same-origin file (public/theme-bootstrap.js, copied to dist/).
 *
 * Storage keys and preset list must stay in sync with app/shared/src/theme.ts
 * and app/shared/src/themePresets.ts (AGENTHUB_THEME_STORAGE_KEY,
 * AGENTHUB_THEME_PRESET_STORAGE_KEY, THEME_PRESETS).
 */
(function () {
  try {
    var mode = localStorage.getItem('agenthub-v4-theme');
    var theme = null;
    if (mode === 'dark' || mode === 'light') {
      theme = mode;
    } else if (mode === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.style.colorScheme = theme;
    }

    var PRESETS = [
      'classic-blue',
      'claude-warm',
      'chatgpt-minimal',
      'deepseek-tech',
      'one-dark-pro',
      'dracula',
    ];
    var preset = localStorage.getItem('agenthub-v4-theme-preset');
    if (preset && PRESETS.indexOf(preset) >= 0) {
      document.documentElement.setAttribute('data-theme-preset', preset);
    } else {
      document.documentElement.removeAttribute('data-theme-preset');
    }
  } catch (err) {
    /* localStorage unavailable — fall back to CSS defaults */
  }
})();
