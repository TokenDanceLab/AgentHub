// Mobile i18n module — re-exports the web i18n module so both
// web and mobile share the same i18next instance, locale files,
// and language detection logic. Importing this module triggers
// i18next initialization (side effect), just like web's main.tsx.
export { default as i18n, normalizeLanguage, getInitialLanguage, setLanguagePreference } from '../../../web/src/i18n/index';
export type { AppLanguage } from '../../../web/src/i18n/index';

// ── Mobile-specific language configuration ──

export type MobileLanguage = 'en' | 'zh';

export const mobileLanguages: Array<{ code: MobileLanguage; nativeLabel: string }> = [
  { code: 'en', nativeLabel: 'English' },
  { code: 'zh', nativeLabel: '中文' },
];
