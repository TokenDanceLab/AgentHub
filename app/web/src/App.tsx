import { useState, useMemo, lazy, Suspense, type ComponentType } from 'react';
import { Monitor, Bot, MessageSquare, Users, FolderGit2 } from 'lucide-react';
import styles from './App.module.css';

/* ── Tab configuration ─────────────────────────────────────────────── */
interface TabDef {
  key: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
}

const tabs: TabDef[] = [
  { key: 'workbench', label: 'Workbench', icon: Monitor },
  { key: 'agentSquare', label: 'Agent Square', icon: Bot },
  { key: 'privateChats', label: 'Private Chats', icon: MessageSquare },
  { key: 'groupWorkspace', label: 'Group Workspace', icon: Users },
  { key: 'project', label: 'Project', icon: FolderGit2 },
];

/* ── Page loaders (graceful fallback when a page is not yet built) ── */
type PageModule = { default: ComponentType<unknown> };

function loadPage(pageName: string): ComponentType<unknown> {
  const loaded = lazy<ComponentType<unknown>>(() =>
    import(`@/pages/${pageName}.tsx`)
      .then((mod: PageModule) => ({ default: mod.default }))
      .catch(() => ({
        default: () => <PlaceholderPage name={pageName} />,
      })),
  );
  return loaded;
}

const pageMap: Record<string, ComponentType<unknown>> = {
  workbench: loadPage('Workbench'),
  agentSquare: loadPage('AgentSquare'),
  privateChats: loadPage('PrivateChats'),
  groupWorkspace: loadPage('GroupWorkspace'),
  project: loadPage('Project'),
};

/* ── Placeholder for unimplemented pages ───────────────────────────── */
function PlaceholderPage({ name }: { name: string }) {
  return (
    <div className={styles.placeholder}>
      <div className={styles.placeholderIcon}>
        <Bot size={48} />
      </div>
      <h2 className={styles.placeholderTitle}>{name}</h2>
      <p className={styles.placeholderText}>Page not yet implemented</p>
    </div>
  );
}

/* ── App ───────────────────────────────────────────────────────────── */
export default function App() {
  const [activeTab, setActiveTab] = useState<string>(tabs[0].key);

  const ActivePage = useMemo(() => pageMap[activeTab] ?? (() => <PlaceholderPage name={activeTab} />), [activeTab]);

  return (
    <div className={styles.root}>
      {/* Tab bar */}
      <header className={styles.header}>
        <div className={styles.brand}>AgentHub Web Preview</div>
        <nav className={styles.tabBar} role="tablist">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {/* Page content */}
      <main className={styles.content}>
        <Suspense fallback={<div className={styles.loading}>Loading...</div>}>
          <ActivePage />
        </Suspense>
      </main>
    </div>
  );
}
