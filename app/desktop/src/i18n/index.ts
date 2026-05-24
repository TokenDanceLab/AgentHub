import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';

try {
  i18n.use(initReactI18next).init({
    resources: { zh: { translation: zh }, en: { translation: en } },
    lng: 'zh',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
} catch (err) {
  console.error('[i18n] Failed to initialize i18next:', err);
  // Init a minimal fallback so useTranslation() doesn't crash the app
  try {
    i18n.use(initReactI18next).init({
      resources: { en: { translation: {} } },
      lng: 'en',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
    });
  } catch {
    // Last resort: if even minimal init fails, the app will use i18n key fallbacks
  }
}

export default i18n;
