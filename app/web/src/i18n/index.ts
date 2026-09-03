import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE, sharedWorkbenchResources } from '@shared/i18n';
import { CHATVIEW_I18N_NAMESPACE, chatviewResources } from '@shared/chatview/i18n/resources';

import zhCommon from './locales/zh/common.json';

import enCommon from './locales/en/common.json';

type AppLanguage = 'en' | 'zh';

const LANGUAGE_STORAGE_KEY = 'agenthub-language';

function normalizeLanguage(value: string | null | undefined): AppLanguage {
  return value?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return value === 'en' || value === 'zh';
}

function readStoredLanguage(): AppLanguage | null {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isAppLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

function detectBrowserLanguage(): AppLanguage {
  if (typeof navigator === 'undefined') return 'en';
  const language = navigator.language || navigator.languages?.[0] || '';
  return normalizeLanguage(language);
}

function getInitialLanguage(): AppLanguage {
  return readStoredLanguage() ?? detectBrowserLanguage() ?? 'en';
}


i18n.use(initReactI18next).init({
  resources: {
    zh: {
      common: zhCommon,


      [SHARED_WORKBENCH_I18N_NAMESPACE]: sharedWorkbenchResources.zh,




      [CHATVIEW_I18N_NAMESPACE]: chatviewResources.zh,
    },
    en: {
      common: enCommon,


      [SHARED_WORKBENCH_I18N_NAMESPACE]: sharedWorkbenchResources.en,




      [CHATVIEW_I18N_NAMESPACE]: chatviewResources.en,
    },
  },
  ns: ['common', SHARED_WORKBENCH_I18N_NAMESPACE, CHATVIEW_I18N_NAMESPACE],
  defaultNS: 'common',
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

if (typeof document !== 'undefined') {
  const syncDocumentLanguage = (language: string) => {
    document.documentElement.lang = normalizeLanguage(language);
  };

  syncDocumentLanguage(i18n.resolvedLanguage || i18n.language || getInitialLanguage());
  i18n.on('languageChanged', syncDocumentLanguage);
}

export default i18n;
