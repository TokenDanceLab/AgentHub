import { Suspense, useCallback, useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import styles from '@/App.module.css';

type Theme = 'light' | 'dark';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem('agenthub-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* localStorage disabled */ }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

type PreviewTab = {
  label: string;
  path: string;
  priority: 'primary' | 'secondary';
};

const previewTabs: PreviewTab[] = [
  {
    path: '/',
    label: 'Workbench',
    priority: 'primary',
  },
  {
    path: '/agent-square',
    label: 'Agent Square',
    priority: 'secondary',
  },
  {
    path: '/chats',
    label: 'Private Chats',
    priority: 'secondary',
  },
  {
    path: '/group/workbench',
    label: 'Group Workspace',
    priority: 'secondary',
  },
  {
    path: '/project/agent-hub',
    label: 'Project Preview',
    priority: 'secondary',
  },
];

function LoadingFallback() {
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
      Loading...
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [pathname, setPathname] = useState(() => router.state.location.pathname);

  useEffect(() => {
    try { localStorage.setItem('agenthub-theme', theme); } catch { /* noop */ }
  }, [theme]);

  useEffect(() => router.subscribe((state) => setPathname(state.location.pathname)), []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const isActiveTab = (path: string) => {
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
  };

  return (
    <div className={styles.root} data-theme={theme}>
      <header className={styles.toolbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>AH</span>
          <span>AgentHub Web Preview</span>
        </div>

        <nav className={styles.tabs} aria-label="Preview pages">
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

        <div className={styles.actions}>
          <button
            className={styles.iconBtn}
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            onClick={toggleTheme}
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}
            type="button"
          >
            {theme === 'light' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>

          <button
            className={styles.iconBtn}
            aria-label="Settings"
            title="Settings"
            type="button"
            onClick={() => {/* TODO: open settings panel */}}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
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
