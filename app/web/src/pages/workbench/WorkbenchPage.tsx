import { useState } from 'react';
import {
  Archive,
  Bot,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  Menu,
  MessageSquare,
  PlusCircle,
  User,
  ChevronRight,
} from 'lucide-react';
import styles from './WorkbenchPage.module.css';

/* ── Types ──────────────────────────────────────────────────────────── */
interface NavItem {
  id: string;
  label: string;
  icon: typeof LayoutGrid;
}

interface Agent {
  id: string;
  name: string;
  initials: string;
  status: 'online' | 'busy' | 'idle';
  role: string;
  progress: number;
}

interface ProjectItem {
  id: string;
  name: string;
  status: 'In Progress' | 'Completed' | 'Review' | 'Pending';
  meta: string;
}

interface ActivityItem {
  id: string;
  title: string;
  time: string;
  dotColor: 'blue' | 'green' | 'purple' | 'orange';
}

/* ── Mock Data ──────────────────────────────────────────────────────── */
const navItems: NavItem[] = [
  { id: 'workbench', label: 'Workbench', icon: LayoutGrid },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'chats', label: 'Chats', icon: MessageSquare },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'archive', label: 'Archive', icon: Archive },
];

const agents: Agent[] = [
  {
    id: 'agent-1',
    name: 'Code Reviewer',
    initials: 'CR',
    status: 'online',
    role: 'Reviewing pull requests and code quality',
    progress: 72,
  },
  {
    id: 'agent-2',
    name: 'Test Runner',
    initials: 'TR',
    status: 'busy',
    role: 'Executing integration test suite',
    progress: 48,
  },
  {
    id: 'agent-3',
    name: 'Deploy Bot',
    initials: 'DB',
    status: 'idle',
    role: 'Waiting for deployment trigger',
    progress: 86,
  },
];

const projects: ProjectItem[] = [
  { id: 'proj-1', name: 'Frontend Migration', status: 'In Progress', meta: 'Updated 2h ago' },
  { id: 'proj-2', name: 'API Gateway v2', status: 'Completed', meta: 'Updated 1d ago' },
  { id: 'proj-3', name: 'Documentation Hub', status: 'Review', meta: 'Updated 5h ago' },
  { id: 'proj-4', name: 'Monitoring Setup', status: 'Pending', meta: 'Updated 3d ago' },
];

const activities: ActivityItem[] = [
  { id: 'act-1', title: 'Code Reviewer completed analysis', time: '2 min ago', dotColor: 'blue' },
  { id: 'act-2', title: 'Test Runner found 3 issues in build #142', time: '15 min ago', dotColor: 'green' },
  { id: 'act-3', title: 'Deploy Bot triggered staging pipeline', time: '1 hour ago', dotColor: 'purple' },
  { id: 'act-4', title: 'New project created: API Gateway v2', time: '3 hours ago', dotColor: 'blue' },
  { id: 'act-5', title: 'Agent Marketplace catalog updated', time: '5 hours ago', dotColor: 'orange' },
  { id: 'act-6', title: 'Frontend Migration build succeeded', time: 'Yesterday', dotColor: 'green' },
];

/* ── Helpers ────────────────────────────────────────────────────────── */
function statusClass(status: Agent['status']): string {
  if (status === 'online') return styles.statusOnline;
  if (status === 'busy') return styles.statusBusy;
  return styles.statusIdle;
}

function statusLabel(status: Agent['status']): string {
  if (status === 'online') return 'Online';
  if (status === 'busy') return 'Busy';
  return 'Idle';
}

function projectBadgeClass(status: ProjectItem['status']): string {
  switch (status) {
    case 'In Progress': return styles.badgeProgress;
    case 'Completed': return styles.badgeDone;
    case 'Review': return styles.badgeReview;
    case 'Pending': return styles.badgePending;
    default: return styles.badgePending;
  }
}

function dotClass(color: ActivityItem['dotColor']): string {
  switch (color) {
    case 'blue': return styles.dotBlue;
    case 'green': return styles.dotGreen;
    case 'purple': return styles.dotPurple;
    case 'orange': return styles.dotOrange;
    default: return styles.dotBlue;
  }
}

/* ── Component ──────────────────────────────────────────────────────── */
export default function WorkbenchPage() {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [activeNav, setActiveNav] = useState('workbench');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAgents = agents.filter(
    (agent) =>
      !searchQuery ||
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.role.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredProjects = projects.filter(
    (project) =>
      !searchQuery ||
      project.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className={styles.root}>
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside
        className={`${styles.sidebar} ${!sidebarExpanded ? styles.sidebarCollapsed : ''}`}
        aria-label="Navigation sidebar"
      >
        {/* Toggle */}
        <button
          className={styles.toggleBtn}
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <Menu size={16} />
        </button>

        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.brandMark}>AH</div>
          <div className={styles.brandText}>
            <div className={styles.brandName}>AgentHub</div>
            <div className={styles.brandSubtitle}>Workbench</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className={styles.nav} aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeNav;
            return (
              <button
                key={item.id}
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                onClick={() => setActiveNav(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={16} />
                <span className={styles.navLabel}>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User */}
        <div className={styles.userArea}>
          <div className={styles.userAvatar}>
            <User size={16} />
          </div>
          <span className={styles.userName}>Trump</span>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <main className={styles.main}>
        {/* Welcome Header */}
        <header className={styles.welcome}>
          <h1 className={styles.welcomeTitle}>Welcome back</h1>
          <p className={styles.welcomeSubtitle}>
            Here is what is happening with your agents and projects today.
          </p>
        </header>

        {/* Quick Actions Bento */}
        <div className={styles.bento}>
          <div className={styles.bentoCard} role="button" tabIndex={0}>
            <div className={styles.bentoIcon}>
              <PlusCircle size={22} />
            </div>
            <div>
              <div className={styles.bentoLabel}>New Agent</div>
              <div className={styles.bentoHint}>Create and configure a new agent</div>
            </div>
          </div>
          <div className={styles.bentoCard} role="button" tabIndex={0}>
            <div className={styles.bentoIcon}>
              <FolderPlus size={22} />
            </div>
            <div>
              <div className={styles.bentoLabel}>New Project</div>
              <div className={styles.bentoHint}>Start a new project workspace</div>
            </div>
          </div>
        </div>

        {/* Active Agents */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Active Agents</h2>
            <span className={styles.sectionCount}>
              {agents.filter((a) => a.status !== 'idle').length} active
            </span>
          </div>
          <div className={styles.agentTable}>
            {filteredAgents.map((agent) => (
              <div key={agent.id} className={styles.agentCard}>
                <div className={styles.agentAvatar}>{agent.initials}</div>
                <div className={styles.agentInfo}>
                  <div className={styles.agentName}>{agent.name}</div>
                  <div className={styles.agentRole}>{agent.role}</div>
                </div>
                <span className={`${styles.agentStatus} ${statusClass(agent.status)}`}>
                  {statusLabel(agent.status)}
                </span>
                <div className={styles.progressWrap}>
                  <div
                    className={styles.progressBar}
                    role="progressbar"
                    aria-valuenow={agent.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span
                      className={styles.progressFill}
                      style={{ width: `${agent.progress}%` }}
                    />
                  </div>
                  <div className={styles.progressLabel}>{agent.progress}%</div>
                </div>
              </div>
            ))}
            {filteredAgents.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyTitle}>No agents found</div>
                <div className={styles.emptyText}>Try adjusting your search query.</div>
              </div>
            )}
          </div>
        </section>

        {/* Recent Projects */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Recent Projects</h2>
            <span className={styles.sectionCount}>
              View all <ChevronRight size={12} style={{ marginLeft: 'var(--space-xs)' } as React.CSSProperties} />
            </span>
          </div>
          <div className={styles.projectsGrid}>
            {filteredProjects.map((project) => (
              <div key={project.id} className={styles.projectCard}>
                <div className={styles.projectIcon}>
                  <FolderOpen size={18} />
                </div>
                <div className={styles.projectInfo}>
                  <div className={styles.projectName}>{project.name}</div>
                  <div className={styles.projectMeta}>{project.meta}</div>
                </div>
                <span className={`${styles.projectBadge} ${projectBadgeClass(project.status)}`}>
                  {project.status}
                </span>
              </div>
            ))}
            {filteredProjects.length === 0 && (
              <div className={styles.emptyState} style={{ gridColumn: '1 / -1' } as React.CSSProperties}>
                <div className={styles.emptyTitle}>No projects found</div>
                <div className={styles.emptyText}>Try adjusting your search query.</div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* ── Right Panel / Activity Timeline ──────────────────────────── */}
      <aside className={styles.rightPanel} aria-label="Activity timeline">
        <h3 className={styles.panelTitle}>Recent Activity</h3>
        <div className={styles.timeline}>
          {activities.map((activity) => (
            <div key={activity.id} className={styles.timelineItem}>
              <span className={`${styles.timelineDot} ${dotClass(activity.dotColor)}`} />
              <div className={styles.timelineContent}>
                <div className={styles.timelineTitle}>{activity.title}</div>
                <div className={styles.timelineTime}>{activity.time}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
