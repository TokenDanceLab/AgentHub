/* ═══════════════════════════════════════════════════════════════════════
   I18N PROVIDER — typed translation context + useI18n hook
   ══════════════════════════════════════════════════════════════════════ */

import { createContext, useContext, useCallback } from 'react'
import type { ReactNode } from 'react'
import { translations, type Locale, type TransKey } from './translations'

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: TransKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  locale,
  setLocale,
  children,
}: {
  locale: Locale
  setLocale: (l: Locale) => void
  children: ReactNode
}) {
  const t = useCallback(
    (key: TransKey, params?: Record<string, string | number>) => {
      let msg: string = (translations[locale] as Record<string, string>)[key] ?? key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          msg = msg.replace(`{${k}}`, String(v))
        }
      }
      return msg
    },
    [locale],
  )

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
