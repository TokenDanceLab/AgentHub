// Mobile i18n module — re-exports the standalone mobile i18n module
// with its own i18next instance, locale files, and language detection.
// Importing this module triggers i18next initialization (side effect).
export { i18n, normalizeLanguage, mobileLanguages, MOBILE_LANGUAGE_STORAGE_KEY } from '../i18n';
export type { MobileLanguage } from '../i18n';
