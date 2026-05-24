import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';

const SUPPORTED = ['zh', 'en'] as const;

function detectLanguage(): string {
  if (typeof navigator === 'undefined') return 'en';
  const raw = navigator.language || (navigator as any).userLanguage || '';
  const base = raw.split('-')[0];
  return SUPPORTED.includes(base as any) ? base : 'en';
}

try {
  i18n.use(initReactI18next).init({
    resources: { zh: { translation: zh }, en: { translation: en } },
    lng: detectLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
} catch (err) {
  console.error('[i18n] Failed to initialize i18next:', err);
  try {
    i18n.use(initReactI18next).init({
      resources: { en: { translation: {} } },
      lng: 'en',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
    });
  } catch {
    // Last resort
  }
}

export default i18n;
