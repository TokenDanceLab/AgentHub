/* ═══════════════════════════════════════════════════════════════════════
   DESIGN SYSTEM PROVIDER — bundles Theme + I18n for single import
   ══════════════════════════════════════════════════════════════════════ */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { ThemeProvider, type Theme } from './theme/ThemeProvider'
import { I18nProvider } from './i18n/I18nProvider'
import { type Locale } from './i18n/translations'

interface Props {
  children: ReactNode
  defaultLocale?: Locale
  defaultTheme?: Theme
}

export default function DesignSystemProvider({
  children,
  defaultLocale = 'zh-CN',
  defaultTheme = 'light',
}: Props) {
  const [locale, setLocale] = useState<Locale>(defaultLocale)
  const [theme, setTheme] = useState<Theme>(defaultTheme)

  return (
    <ThemeProvider theme={theme} setTheme={setTheme}>
      <I18nProvider locale={locale} setLocale={setLocale}>
        {children}
      </I18nProvider>
    </ThemeProvider>
  )
}

export { useTheme } from './theme/ThemeProvider'
export { useI18n } from './i18n/I18nProvider'
export { type Locale, type TransKey, locales } from './i18n/translations'
