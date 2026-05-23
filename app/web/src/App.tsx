import { useMemo, useState } from 'react';
import AgentSquarePage from '@/pages/agent-square/AgentSquarePageInteractive';
import GroupWorkspacePage from '@/pages/group-workspace/GroupWorkspacePageInteractive';
import PrivateChatsPage from '@/pages/private-chats/PrivateChatsPageInteractive';
import ProjectPage from '@/pages/projects/ProjectPageInteractive';
import WorkbenchPage from '@/pages/workbench/WorkbenchPageInteractive';
import styles from '@/App.module.css';

type PreviewPage = {
  id: string;
  label: string;
  component: () => React.ReactElement;
};

const previewPages: PreviewPage[] = [
  {
    id: 'workbench',
    label: 'Workbench',
    component: WorkbenchPage,
  },
  {
    id: 'agent-square',
    label: 'Agent Square',
    component: AgentSquarePage,
  },
  {
    id: 'private-chats',
    label: 'Private Chats',
    component: PrivateChatsPage,
  },
  {
    id: 'group-workspace',
    label: 'Group Workspace',
    component: GroupWorkspacePage,
  },
  {
    id: 'project',
    label: 'Project',
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
        <ActivePage />
      </main>
    </div>
  );
}
