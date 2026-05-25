import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n, { type AppLanguage, normalizeLanguage, setLanguagePreference } from '@/i18n';
import { router } from '@/router';
import styles from '@/App.module.css';

type Theme = 'light' | 'dark';

type PreviewTab = {
  label: string;
  path: string;
  priority: 'primary' | 'secondary';
};

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem('agenthub-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage disabled
  }

  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
}

function LoadingFallback() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      style={{
        color: 'var(--text-muted)',
        display: 'grid',
        fontSize: 13,
        fontWeight: 700,
        height: '100%',
        minHeight: 180,
        placeItems: 'center',
      }}
    >
      {t('loading')}
    </div>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [pathname, setPathname] = useState(() => router.state.location.pathname);
  const [language, setLanguage] = useState<AppLanguage>(
    normalizeLanguage(i18n.resolvedLanguage || i18n.language),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const previewTabs = useMemo<PreviewTab[]>(
    () => [
      {
        path: '/',
        label: t('nav.workbench'),
        priority: 'primary',
      },
      {
        path: '/agent-square',
        label: t('nav.agentSquare'),
        priority: 'secondary',
      },
      {
        path: '/chats',
        label: t('nav.privateChats'),
        priority: 'secondary',
      },
      {
        path: '/group/workbench',
        label: t('nav.groupWorkspace'),
        priority: 'secondary',
      },
      {
        path: '/project/agent-hub',
        label: t('nav.projectPreview'),
        priority: 'secondary',
      },
    ],
    [t],
  );

  useEffect(() => {
    try {
      localStorage.setItem('agenthub-theme', theme);
    } catch {
      // noop
    }
  }, [theme]);

  useEffect(() => {
    const unsubscribeRouter = router.subscribe((state) => setPathname(state.location.pathname));
    const handleLanguageChange = (nextLanguage: string) => {
      setLanguage(normalizeLanguage(nextLanguage));
    };

    i18n.on('languageChanged', handleLanguageChange);

    return () => {
      unsubscribeRouter();
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const selectLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguage(nextLanguage);
    setLanguagePreference(nextLanguage);
    setSettingsOpen(false);
  }, []);

  const isActiveTab = useCallback(
    (path: string) => {
      if (path === '/') {
        return pathname === '/';
      }

      if (path === '/group/workbench') {
        return pathname === path || pathname.startsWith('/group/');
      }

      if (path === '/project/agent-hub') {
        return pathname === path || pathname.startsWith('/project/');
      }

      return pathname === path || pathname.startsWith(`${path}/`);
    },
    [pathname],
  );

  return (
    <div className={styles.root} data-theme={theme}>
      <header className={styles.toolbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>AH</span>
          <span>{t('brand.webPreview')}</span>
        </div>

        <nav className={styles.tabs} aria-label={t('nav.previewPages')}>
          {previewTabs.map((page) => (
            <button
              className={isActiveTab(page.path) ? styles.activeTab : styles.tab}
              data-priority={page.priority}
              key={page.path}
              onClick={() => void router.navigate(page.path)}
              type="button"
            >
              {page.label}
            </button>
          ))}
        </nav>

        <div className={styles.actions} ref={settingsRef}>
          <button
            className={styles.iconBtn}
            aria-label={theme === 'light' ? t('theme.switchToDark') : t('theme.switchToLight')}
            onClick={toggleTheme}
            title={theme === 'light' ? t('theme.dark') : t('theme.light')}
            type="button"
          >
            {theme === 'light' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>

          <button
            className={styles.iconBtn}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            aria-label={t('settings.open')}
            onClick={() => setSettingsOpen((current) => !current)}
            title={t('settings.open')}
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {settingsOpen ? (
            <div className={styles.settingsMenu} role="dialog" aria-label={t('settings.title')}>
              <div className={styles.settingsSection}>
                <div className={styles.settingsLabel}>{t('settings.language')}</div>
                <div className={styles.segmentedControl} role="group" aria-label={t('settings.language')}>
                  <button
                    className={language === 'en' ? styles.segmentActive : styles.segment}
                    aria-pressed={language === 'en'}
                    onClick={() => selectLanguage('en')}
                    type="button"
                  >
                    English
                  </button>
                  <button
                    className={language === 'zh' ? styles.segmentActive : styles.segment}
                    aria-pressed={language === 'zh'}
                    onClick={() => selectLanguage('zh')}
                    type="button"
                  >
                    中文
                  </button>
                </div>
              </div>

              <div className={styles.settingsSection}>
                <div className={styles.settingsLabel}>{t('settings.theme')}</div>
                <button className={styles.settingsAction} onClick={toggleTheme} type="button">
                  {theme === 'light' ? t('theme.dark') : t('theme.light')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <main className={styles.preview}>
        <Suspense fallback={<LoadingFallback />}>
          <RouterProvider router={router} />
        </Suspense>
      </main>
    </div>
  );
}
