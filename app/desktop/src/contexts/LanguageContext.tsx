import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import i18n from '@/i18n';

type Language = 'en' | 'zh';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = 'agenthub-language';
const SUPPORTED: Language[] = ['en', 'zh'];

function getStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch {
    /* localStorage unavailable */
  }
  return (i18n.language?.split('-')[0]) as Language || 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getStoredLanguage);

  // Sync i18n to stored language on mount (belt-and-suspenders with detectLanguage).
  useEffect(() => {
    const stored = getStoredLanguage();
    if (i18n.language !== stored) {
      void i18n.changeLanguage(stored);
    }
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* localStorage unavailable */
    }
    void i18n.changeLanguage(lang);
  }, []);

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
