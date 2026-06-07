import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE, sharedWorkbenchResources } from '@shared/i18n';
import zh from './locales/zh.json';
import en from './locales/en.json';

const SUPPORTED = ['zh', 'en'] as const;
type SupportedLanguage = (typeof SUPPORTED)[number];

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return SUPPORTED.includes(value as SupportedLanguage);
}

function detectLanguage(): string {
  if (typeof navigator === 'undefined') return 'en';
  const legacyNavigator = navigator as Navigator & { userLanguage?: string };
  const raw = navigator.language || legacyNavigator.userLanguage || '';
  const base = raw.split('-')[0]!;
  return isSupportedLanguage(base) ? base : 'en';
}

try {
  i18n.use(initReactI18next).init({
    resources: {
      zh: {
        translation: zh,
        [SHARED_WORKBENCH_I18N_NAMESPACE]: sharedWorkbenchResources.zh,
      },
      en: {
        translation: en,
        [SHARED_WORKBENCH_I18N_NAMESPACE]: sharedWorkbenchResources.en,
      },
    },
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
