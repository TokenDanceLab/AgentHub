<<<<<<< HEAD
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSurfaceMetadata, type SurfaceId, type SurfaceStatus } from '@shared/surfaceMetadata';
import i18n, { type AppLanguage, normalizeLanguage, setLanguagePreference } from '@/i18n';
import { router } from '@/router';
import styles from '@/App.module.css';

type Theme = 'light' | 'dark';
type SourceTone = 'demo' | 'catalog' | 'locked' | 'error';

type ShellPage = {
  description: string;
  label: string;
  path: string;
  priority: 'primary' | 'secondary';
  source: SurfaceStatus;
  workspace: string;
};

const WEB_SURFACE_ROUTES = [
  { id: 'web.workbench', path: '/', workspaceKey: 'shell.workspace.localEdge', priority: 'primary' },
  { id: 'web.agentSquare', path: '/agent-square', workspaceKey: 'shell.workspace.catalog', priority: 'secondary' },
  { id: 'web.privateChats', path: '/chats', workspaceKey: 'shell.workspace.hubSession', priority: 'secondary' },
  { id: 'web.groupWorkspace', path: '/group/workbench', workspaceKey: 'shell.workspace.group', priority: 'secondary' },
  { id: 'web.projectPreview', path: '/project/agent-hub', workspaceKey: 'shell.workspace.project', priority: 'secondary' },
] as const satisfies readonly {
  id: SurfaceId;
  path: string;
  workspaceKey: string;
  priority: 'primary' | 'secondary';
}[];

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

  const shellPages = useMemo<ShellPage[]>(
    () =>
      WEB_SURFACE_ROUTES.map((route) => {
        const surface = getSurfaceMetadata(route.id);

        return {
          path: route.path,
          label: t(surface.labelKey),
          description: t(surface.descriptionKey),
          workspace: t(route.workspaceKey),
          source: surface.defaultStatus,
          priority: route.priority,
        };
      }),
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

  const activePage = useMemo(() => (
    shellPages.find((page) => isActiveTab(page.path)) ?? shellPages[0]!
  ), [isActiveTab, shellPages]);

  const sourceTone = sourceToneFromStatus(activePage.source);
  const sourceLabel = t(sourceLabelKey(activePage.source));
  const sourceDetail = t(sourceDetailKey(activePage.source));

  return (
    <div className={styles.root} data-theme={theme}>
      <header className={styles.toolbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>AH</span>
          <span className={styles.brandCopy}>
            <strong>AgentHub</strong>
            <span>{t('shell.brand.surface')}</span>
          </span>
        </div>

        <div className={styles.toolbarMeta} aria-label={t('shell.toolbar.status')}>
          <span className={styles.statusChip} data-tone="error">
            <span className={styles.statusDot} />
            {t('shell.status.edgeUnavailable')}
          </span>
          <span className={styles.statusChip} data-tone={sourceTone}>
            <span className={styles.statusDot} />
            {sourceLabel}
          </span>
        </div>

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

      <div className={styles.shell}>
        <aside className={styles.sidebar} aria-label={t('shell.sidebar.label')}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>{t('shell.sidebar.pages')}</span>
            <span className={styles.sidebarCount}>{shellPages.length}</span>
          </div>
          <nav className={styles.navList} aria-label={t('nav.previewPages')}>
            {shellPages.map((page) => (
              <button
                className={isActiveTab(page.path) ? styles.activeNavItem : styles.navItem}
                data-priority={page.priority}
                key={page.path}
                onClick={() => void router.navigate(page.path)}
                type="button"
              >
                <span className={styles.navGlyph} aria-hidden="true">{page.label.slice(0, 1)}</span>
                <span className={styles.navText}>
                  <span>{page.label}</span>
                  <small>{page.workspace}</small>
                </span>
                <span
                  className={styles.navSourceDot}
                  data-tone={sourceToneFromStatus(page.source)}
                  aria-label={t(sourceLabelKey(page.source))}
                />
              </button>
            ))}
          </nav>

          <div className={styles.sidebarFooter}>
            <span className={styles.footerLabel}>{t('shell.sidebar.boundary')}</span>
            <p>{t('shell.sidebar.boundary.detail')}</p>
          </div>
        </aside>

        <main className={styles.mainSurface}>
          <div className={styles.contentToolbar}>
            <div className={styles.contentTitle}>
              <span className={styles.workspaceKicker}>{activePage.workspace}</span>
              <h1>{activePage.label}</h1>
            </div>
            <span className={styles.contentStatus} data-tone={sourceTone}>{sourceLabel}</span>
          </div>
          <p className={styles.contentDescription}>{activePage.description}</p>
          <section className={styles.routerSurface} aria-label={activePage.label}>
            <Suspense fallback={<LoadingFallback />}>
              <RouterProvider router={router} />
            </Suspense>
          </section>
        </main>

        <aside className={styles.statusPanel} aria-label={t('shell.statusPanel.label')}>
          <div className={styles.panelBlock}>
            <span className={styles.panelLabel}>{t('shell.statusPanel.current')}</span>
            <strong>{activePage.label}</strong>
            <p>{activePage.description}</p>
          </div>

          <div className={styles.panelBlock}>
            <span className={styles.panelLabel}>{t('shell.statusPanel.source')}</span>
            <span className={styles.sourceBadge} data-tone={sourceTone}>
              <span className={styles.statusDot} />
              {sourceLabel}
            </span>
            <p>{sourceDetail}</p>
          </div>

          <div className={styles.panelBlock}>
            <span className={styles.panelLabel}>{t('shell.statusPanel.routes')}</span>
            <div className={styles.routeStack}>
              {shellPages.map((page) => (
                <button
                  className={isActiveTab(page.path) ? styles.activeRouteItem : styles.routeItem}
                  key={page.path}
                  onClick={() => void router.navigate(page.path)}
                  type="button"
                >
                  <span>{page.label}</span>
                  <small>{page.path}</small>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
=======
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { queryClient } from '@/api/queryClient';
import WebLayout from '@/layouts/WebLayout';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WebLayout />
      </ThemeProvider>
    </QueryClientProvider>
>>>>>>> origin/dev/delicious233
  );
}

function sourceToneFromStatus(status: SurfaceStatus): SourceTone {
  if (status === 'catalogFallback') return 'catalog';
  if (status === 'loginLocked') return 'locked';
  if (status === 'demoFallback') return 'demo';
  return 'error';
}

function sourceLabelKey(status: SurfaceStatus) {
  if (status === 'catalogFallback') return 'surface.status.catalogFallback.label';
  if (status === 'loginLocked') return 'surface.status.loginLocked.label';
  if (status === 'demoFallback') return 'surface.status.demoFallback.label';
  return 'surface.status.error.label';
}

function sourceDetailKey(status: SurfaceStatus) {
  if (status === 'catalogFallback') return 'surface.status.catalogFallback.description';
  if (status === 'loginLocked') return 'surface.status.loginLocked.description';
  if (status === 'demoFallback') return 'surface.status.demoFallback.description';
  return 'surface.status.error.description';
}
