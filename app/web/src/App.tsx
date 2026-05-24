import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import styles from '@/App.module.css';

type PreviewPage = {
  id: string;
  label: string;
  priority: 'primary' | 'secondary';
  component: () => React.ReactElement;
};

const previewPages: PreviewPage[] = [
  {
    id: 'workbench',
    label: 'Workbench',
    priority: 'primary',
    component: WorkbenchPage,
  },
  {
    id: 'agent-square',
    label: 'Agent Square',
    priority: 'secondary',
    component: AgentSquarePage,
  },
  {
    id: 'private-chats',
    label: 'Private Chats',
    priority: 'secondary',
    component: PrivateChatsPage,
  },
  {
    id: 'group-workspace',
    label: 'Group Workspace',
    priority: 'secondary',
    component: GroupWorkspacePage,
  },
  {
    id: 'project',
    label: 'Project Preview',
    priority: 'secondary',
    component: ProjectPage,
  },
];

export default function App() {
  const [activePageId, setActivePageId] = useState(previewPages[0].id);

  const activePage = useMemo(
    () => previewPages.find((page) => page.id === activePageId) ?? previewPages[0],
    [activePageId],
  );

  const ActivePage = activePage.component;

  return (
    <div className={styles.root}>
      <header className={styles.toolbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>AH</span>
          <span>AgentHub Web Preview</span>
        </div>

        <nav className={styles.tabs} aria-label="Preview pages">
          {previewPages.map((page) => (
            <button
              className={page.id === activePage.id ? styles.activeTab : styles.tab}
              data-priority={page.priority}
              key={page.id}
              onClick={() => setActivePageId(page.id)}
              type="button"
            >
              {page.label}
            </button>
          ))}
        </nav>
      </header>

      <main className={styles.preview}>
        <p>Loading...</p>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
