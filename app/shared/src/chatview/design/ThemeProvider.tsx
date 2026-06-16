/* ═══════════════════════════════════════════════════════════════════════
   THEME PROVIDER — CSS custom property switching via data-theme
   Supports uncontrolled (own state + localStorage) and controlled (props).
   ══════════════════════════════════════════════════════════════════════ */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'

export type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'chatview-theme'

function loadTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
}

interface Props {
  children: ReactNode
  theme?: Theme
  setTheme?: (t: Theme) => void
}

export function ThemeProvider({ children, theme: controlledTheme, setTheme: controlledSet }: Props) {
  const [internalTheme, setInternal] = useState<Theme>(loadTheme)
  const theme = controlledTheme ?? internalTheme

  useEffect(() => { applyTheme(theme) }, [theme])

  const setTheme = useCallback((t: Theme) => {
    if (controlledSet) { controlledSet(t); return }
    setInternal(t)
    localStorage.setItem(STORAGE_KEY, t)
  }, [controlledSet])

  const toggle = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
  }, [theme, setTheme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
