import { useState } from 'react';
import {
  FileText,
  Bot,
  Play,
  Box,
  Users,
  Clock,
  FolderOpen,
  File,
  Settings,
  Info,
  ChevronRight,
  CheckCircle,
  Rocket,
} from 'lucide-react';
import styles from './ProjectPage.module.css';

/* ── Types ──────────────────────────────────────────────────────────── */
type Tab = 'Overview' | 'Files' | 'Activity' | 'Settings';

interface TabDef {
  key: Tab;
  label: string;
  icon: typeof Info;
}

interface StatCard {
  key: string;
  label: string;
  value: number;
  icon: typeof FileText;
}

interface FileNode {
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  time: string;
  type: 'deploy' | 'review' | 'agent' | 'file' | 'run';
}

interface TeamMember {
  name: string;
  initials: string;
}

/* ── Mock Data ──────────────────────────────────────────────────────── */
const tabs: TabDef[] = [
  { key: 'Overview', label: 'Overview', icon: Info },
  { key: 'Files', label: 'Files', icon: FolderOpen },
  { key: 'Activity', label: 'Activity', icon: Clock },
  { key: 'Settings', label: 'Settings', icon: Settings },
];

const project = {
  name: 'Workspace Preview Foundation',
  description:
    'Coordinate frontend preview pages, milestones, task readiness, design files, and dry-run records before real API integration.',
  status: 'In Progress' as const,
};

const team: TeamMember[] = [
  { name: 'Alice', initials: 'AL' },
  { name: 'Bob', initials: 'BO' },
  { name: 'Carol', initials: 'CA' },
];

const stats: StatCard[] = [
  { key: 'files', label: 'Files', value: 24, icon: FileText },
  { key: 'agents', label: 'Agents', value: 7, icon: Bot },
  { key: 'runs', label: 'Runs', value: 156, icon: Play },
  { key: 'artifacts', label: 'Artifacts', value: 12, icon: Box },
];

const fileTree: FileNode[] = [
  {
    name: 'src',
    type: 'folder',
    children: [
      {
        name: 'pages',
        type: 'folder',
        children: [
          { name: 'WorkbenchPage.tsx', type: 'file' },
          { name: 'AgentSquarePage.tsx', type: 'file' },
          { name: 'ProjectPage.tsx', type: 'file' },
        ],
      },
      {
        name: 'components',
        type: 'folder',
        children: [
          { name: 'Sidebar.tsx', type: 'file' },
          { name: 'AgentCard.tsx', type: 'file' },
          { name: 'SearchBar.tsx', type: 'file' },
        ],
      },
      { name: 'App.tsx', type: 'file' },
      { name: 'main.tsx', type: 'file' },
      { name: 'vite-env.d.ts', type: 'file' },
    ],
  },
  {
    name: 'public',
    type: 'folder',
    children: [{ name: 'favicon.svg', type: 'file' }],
  },
  { name: 'package.json', type: 'file' },
  { name: 'tsconfig.json', type: 'file' },
  { name: 'vite.config.ts', type: 'file' },
  { name: '.gitignore', type: 'file' },
];

const activities: ActivityItem[] = [
  {
    id: 'act-1',
    title: 'Deploy completed',
    detail: 'v2.1.0 deployed to staging environment',
    time: '2 min ago',
    type: 'deploy',
  },
  {
    id: 'act-2',
    title: 'Code review merged',
    detail: 'PR #128 merged by Alice into main branch',
    time: '15 min ago',
    type: 'review',
  },
  {
    id: 'act-3',
    title: 'New agent added',
    detail: 'Test Suite Generator added to workspace',
    time: '1 hour ago',
    type: 'agent',
  },
  {
    id: 'act-4',
    title: 'File updated',
    detail: 'WorkbenchPage.tsx modified with new sidebar layout',
    time: '3 hours ago',
    type: 'file',
  },
  {
    id: 'act-5',
    title: 'Run completed',
    detail: 'Integration tests passed (156/156)',
    time: '5 hours ago',
    type: 'run',
  },
  {
    id: 'act-6',
    title: 'Review submitted',
    detail: 'Bob approved the sidebar refactor PR',
    time: 'Yesterday',
    type: 'review',
  },
];

/* ── Helpers ────────────────────────────────────────────────────────── */
function statusClass(status: string): string {
  switch (status) {
    case 'In Progress': return styles.statusProgress;
    case 'Completed': return styles.statusDone;
    case 'Review': return styles.statusReview;
    default: return styles.statusProgress;
  }
}

function activityIconClass(type: ActivityItem['type']): string {
  switch (type) {
    case 'deploy': return styles.iconDeploy;
    case 'review': return styles.iconReview;
    case 'agent': return styles.iconAgent;
    case 'file': return styles.iconFile;
    case 'run': return styles.iconRun;
    default: return styles.iconFile;
  }
}

function ActivityIcon({ type }: { type: ActivityItem['type'] }) {
  const size = 14;
  switch (type) {
    case 'deploy': return <Rocket size={size} />;
    case 'review': return <CheckCircle size={size} />;
    case 'agent': return <Bot size={size} />;
    case 'file': return <FileText size={size} />;
    case 'run': return <Play size={size} />;
    default: return <Info size={size} />;
  }
}

/* ── FileTree (recursive) ───────────────────────────────────────────── */
function FileTree({ nodes, depth = 0 }: { nodes: FileNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((node) => {
        const isFolder = node.type === 'folder';
        const iconSize = 14;
        return (
          <div key={node.name}>
            <div
              className={`${styles.fileNode} ${isFolder ? styles.fileNodeFolder : ''} ${depth === 0 ? styles.fileNodeRoot : ''}`}
              style={{ paddingLeft: `calc(var(--space-md) + ${depth * 20}px)` } as React.CSSProperties}
            >
              {isFolder ? (
                <FolderOpen size={iconSize} className={styles.fileIcon} />
              ) : (
                <File size={iconSize} className={styles.fileIcon} />
              )}
              <span>{node.name}</span>
              {isFolder && (
                <ChevronRight size={10} className={styles.fileIcon} />
              )}
            </div>
            {isFolder && node.children && (
              <div className={styles.fileChildren}>
                <FileTree nodes={node.children} depth={depth + 1} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ── Component ──────────────────────────────────────────────────────── */
export default function ProjectPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Overview');

  return (
    <div className={styles.root}>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerInfo}>
          <h1 className={styles.projectName}>{project.name}</h1>
          <p className={styles.projectDesc}>{project.description}</p>
        </div>
        <div className={styles.headerMeta}>
          <span className={`${styles.projectStatus} ${statusClass(project.status)}`}>
            {project.status}
          </span>
          <div className={styles.teamAvatars}>
            {team.map((member) => (
              <div
                key={member.initials}
                className={styles.teamAvatar}
                title={member.name}
                aria-label={member.name}
              >
                {member.initials}
              </div>
            ))}
          </div>
          <Users size={16} style={{ color: 'var(--muted-foreground)' } as React.CSSProperties} />
        </div>
      </header>

      {/* ── Tab Bar ──────────────────────────────────────────────────── */}
      <nav className={styles.tabBar} role="tablist" aria-label="Project tabs">
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
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Tab Content ──────────────────────────────────────────────── */}
      <div className={styles.content}>
        {/* Overview Tab */}
        {activeTab === 'Overview' && (
          <>
            {/* Description */}
            <div>
              <p className={styles.description}>{project.description}</p>
            </div>

            {/* Stats */}
            <div className={styles.statsGrid}>
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.key} className={styles.statCard}>
                    <div className={styles.statIcon}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <div className={styles.statValue}>{stat.value}</div>
                      <div className={styles.statLabel}>{stat.label}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Team */}
            <div className={styles.sectionCard}>
              <div className={styles.sectionCardHeader}>
                <h3 className={styles.sectionCardTitle}>Team</h3>
                <Users size={14} style={{ color: 'var(--muted-foreground)' } as React.CSSProperties} />
              </div>
              <div style={{ padding: 'var(--space-md) var(--space-lg)' } as React.CSSProperties}>
                {team.map((member) => (
                  <div
                    key={member.initials}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-md)',
                      padding: 'var(--space-sm) 0',
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--font-weight-normal)',
                      color: 'var(--foreground)',
                    } as React.CSSProperties}
                  >
                    <div className={styles.teamAvatar}>{member.initials}</div>
                    <span>{member.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Files Tab */}
        {activeTab === 'Files' && (
          <div className={styles.sectionCard}>
            <div className={styles.sectionCardHeader}>
              <h3 className={styles.sectionCardTitle}>Project Files</h3>
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-normal)', color: 'var(--muted-foreground)' } as React.CSSProperties}>
                {fileTree.length} top-level entries
              </span>
            </div>
            <div className={styles.fileTree}>
              <FileTree nodes={fileTree} />
            </div>
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === 'Activity' && (
          <div className={styles.sectionCard}>
            <div className={styles.sectionCardHeader}>
              <h3 className={styles.sectionCardTitle}>Recent Activity</h3>
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-normal)', color: 'var(--muted-foreground)' } as React.CSSProperties}>
                {activities.length} events
              </span>
            </div>
            <div className={styles.activityList}>
              {activities.map((activity) => (
                <div key={activity.id} className={styles.activityItem}>
                  <div className={`${styles.activityIcon} ${activityIconClass(activity.type)}`}>
                    <ActivityIcon type={activity.type} />
                  </div>
                  <div>
                    <div className={styles.activityTitle}>{activity.title}</div>
                    <div className={styles.activityDetail}>{activity.detail}</div>
                  </div>
                  <span className={styles.activityTime}>{activity.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'Settings' && (
          <div className={styles.sectionCard}>
            <div className={styles.sectionCardHeader}>
              <h3 className={styles.sectionCardTitle}>Project Settings</h3>
            </div>
            <div style={{ padding: 'var(--space-xl)' } as React.CSSProperties}>
              <div className={styles.emptyState}>
                <Settings size={32} style={{ color: 'var(--muted-foreground)', opacity: 0.4 } as React.CSSProperties} />
                <div className={styles.emptyTitle}>Settings coming soon</div>
                <div className={styles.emptyText}>
                  Project configuration and preferences will appear here.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
