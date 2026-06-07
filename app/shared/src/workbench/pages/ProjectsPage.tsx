import React, { useCallback } from 'react';
import {
  DesignFileIcon,
  DesignNavIcon,
  type DesignNavIconName,
} from '../designIcons';
import styles from './ProjectsPage.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   ProjectsPage — pure presentational workbench page
   ═══════════════════════════════════════════════════════════════════════ */

// ── Data shapes ──

export type ProjectRunStatus =
  | 'running'
  | 'thinking'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ProjectRun {
  id: string;
  name: string;
  status: ProjectRunStatus;
  owner: string;
  meta: string;
}

export interface ProjectArtifact {
  id: string;
  /** File extension: 'md', 'xlsx', 'css', 'html', 'js', 'ts', etc. */
  type: string;
  name: string;
}

export interface ProjectFeedItem {
  id: string;
  time: string;
  text: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  /** Status label displayed in the nav and head badge */
  status: string;
  /** Supplementary meta: "3 runs", "12 docs" etc. */
  meta: string;
  members: string[];
  announcement: string;
  runs: ProjectRun[];
  artifacts: ProjectArtifact[];
  feed: ProjectFeedItem[];
}

export type ProjectFilter = 'all' | 'running' | 'completed' | 'archived';

export type ProjectTab = 'overview' | 'runs' | 'artifacts' | 'archive' | 'settings';

export interface ProjectsPageProps {
  /** Full list of projects (shown in left nav) */
  projects: ProjectInfo[];
  /** Currently selected project id */
  activeProjectId: string | null;
  /** Called when user clicks a project in the nav */
  onProjectSelect: (projectId: string) => void;

  /** Search query */
  searchQuery?: string;
  /** Called when search input changes */
  onSearchChange?: ((query: string) => void) | undefined;

  /** Active filter in the left nav */
  activeFilter: ProjectFilter;
  /** Called when user clicks a filter button */
  onFilterChange: (filter: ProjectFilter) => void;

  /** Active tab in the detail view */
  activeTab: ProjectTab;
  /** Called when user clicks a tab */
  onTabChange: (tab: ProjectTab) => void;

  /** Called when "新建项目" is clicked */
  onNewProject?: (() => void) | undefined;
  /** Called when announcement edit is clicked */
  onEditAnnouncement?: ((projectId: string) => void) | undefined;
  /** Called when a run row is clicked */
  onRunClick?: ((projectId: string, run: ProjectRun) => void) | undefined;
  /** Called when an artifact row is clicked */
  onArtifactClick?: ((projectId: string, artifact: ProjectArtifact) => void) | undefined;
}

// ── Defaults / demo data ──

export const DEFAULT_PROJECTS: ProjectInfo[] = [
  {
    id: 'ai-game',
    name: 'AI 游戏项目',
    description: '深度研究团队 · 5 人',
    status: '研究中',
    meta: '3 runs',
    members: ['Delicious233', 'Johnny', 'Trump', 'Builder', 'Researcher'],
    announcement:
      '题材方向已收敛到二次元卡牌 Roguelite，下一步生成 prototype checklist。',
    runs: [
      { id: 'r1', name: '题材方向研究', status: 'running', owner: 'Researcher', meta: '35%' },
      { id: 'r2', name: '玩法拆解', status: 'completed', owner: 'Builder', meta: '8 docs' },
      { id: 'r3', name: '原型清单', status: 'waiting', owner: 'Orchestrator', meta: '待启动' },
    ],
    artifacts: [
      { id: 'a1', type: 'md', name: 'game-research-brief.md' },
      { id: 'a2', type: 'xlsx', name: '竞品矩阵.xlsx' },
      { id: 'a3', type: 'md', name: 'prototype-tasks.md' },
    ],
    feed: [
      { id: 'f1', time: '16:20', text: 'Researcher 更新题材方向' },
      { id: 'f2', time: '15:42', text: 'Johnny 上传竞品矩阵' },
      { id: 'f3', time: '14:25', text: 'Builder 完成玩法拆解' },
    ],
  },
  {
    id: 'docs-refactor',
    name: '文档重构',
    description: '产物归档完成',
    status: '待归档确认',
    meta: '12 docs',
    members: ['Delicious233', 'Johnny', 'Reviewer'],
    announcement:
      'README、roadmap、handoff 已完成，Reviewer 正在做最终归档确认。',
    runs: [
      { id: 'r4', name: 'README 结构更新', status: 'completed', owner: 'Builder', meta: '12 files' },
      { id: 'r5', name: 'Handoff 生成', status: 'completed', owner: 'Deployer', meta: '3 docs' },
      { id: 'r6', name: '归档审查', status: 'running', owner: 'Reviewer', meta: '72%' },
    ],
    artifacts: [
      { id: 'a4', type: 'md', name: 'docs-refactor-handoff.md' },
      { id: 'a5', type: 'md', name: 'README.md' },
      { id: 'a6', type: 'md', name: 'roadmap.md' },
    ],
    feed: [
      { id: 'f4', time: '12:20', text: 'Reviewer 补充归档建议' },
      { id: 'f5', time: '11:54', text: 'README 入口整理完成' },
      { id: 'f6', time: '11:36', text: 'roadmap 旧内容完成归档' },
    ],
  },
];

const FILTER_ITEMS: { id: ProjectFilter; label: string; icon: DesignNavIconName }[] = [
  { id: 'all', label: '全部项目', icon: 'grid' },
  { id: 'running', label: '运行中', icon: 'running' },
  { id: 'completed', label: '已完成', icon: 'done' },
  { id: 'archived', label: '归档', icon: 'archive' },
];

const TAB_ITEMS: { id: ProjectTab; label: string; icon: DesignNavIconName }[] = [
  { id: 'overview', label: '概览', icon: 'home' },
  { id: 'runs', label: '运行', icon: 'running' },
  { id: 'artifacts', label: '产物', icon: 'package' },
  { id: 'archive', label: '归档', icon: 'archive' },
  { id: 'settings', label: '设置', icon: 'tools' },
];

// ── State dot class resolver ──

function stateDotClass(status: ProjectRunStatus): string {
  switch (status) {
    case 'running':
    case 'completed':
      return styles.stateRunning ?? '';
    case 'thinking':
      return styles.stateThinking ?? '';
    case 'waiting':
      return styles.stateWaiting ?? '';
    case 'failed':
      return styles.stateFailed ?? '';
    case 'cancelled':
      return styles.stateCancelled ?? '';
    default:
      return '';
  }
}

// ── Sub-components ──

function ProjectNavRow({
  project,
  isActive,
  onSelect,
}: {
  project: ProjectInfo;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  const handleClick = useCallback(() => {
    onSelect(project.id);
  }, [project.id, onSelect]);

  const rowClass = `${styles.navRow} ${isActive ? styles.navRowActive : ''}`;

  return (
    <button type="button" className={rowClass} onClick={handleClick}>
      <span className={styles.navRowIcon}>
        <DesignNavIcon name={isActive ? 'grid' : 'folder'} size={15} />
      </span>
      <span className={styles.navRowCopy}>
        <strong className={styles.navRowName}>{project.name}</strong>
        <small className={styles.navRowDesc}>{project.description}</small>
      </span>
      <em className={styles.navRowStatus}>{project.status}</em>
    </button>
  );
}

function FilterList({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: ProjectFilter;
  onFilterChange: (filter: ProjectFilter) => void;
}) {
  return (
    <div className={styles.filterList}>
      {FILTER_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.filterBtn} ${activeFilter === item.id ? styles.filterBtnActive : ''}`}
          onClick={() => onFilterChange(item.id)}
        >
          <span className={styles.filterBtnIcon}>
            <DesignNavIcon name={item.icon} size={15} />
          </span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ProjectTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
}) {
  return (
    <div className={styles.tabs}>
      {TAB_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.tabBtn} ${activeTab === item.id ? styles.tabBtnActive : ''}`}
          onClick={() => onTabChange(item.id)}
        >
          <DesignNavIcon name={item.icon} size={15} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Announcement({
  text,
  onEdit,
}: {
  text: string;
  onEdit?: (() => void) | undefined;
}) {
  return (
    <section className={styles.announcement}>
      <span className={styles.announcementMark} />
      <div className={styles.announcementBody}>
        <strong className={styles.announcementLabel}>
          <DesignNavIcon name="notes" size={15} />项目公告
        </strong>
        <p className={styles.announcementText}>{text}</p>
      </div>
      <button
        type="button"
        className={styles.announcementEditBtn}
        onClick={onEdit}
      >
        编辑
      </button>
    </section>
  );
}

function MembersCard({ members }: { members: string[] }) {
  return (
    <section className={styles.membersCard}>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="users" size={15} />成员
        </h2>
        <span>{members.length} people</span>
      </div>
      <div className={styles.memberChips}>
        {members.map((name) => (
          <span key={name} className={styles.memberChip}>
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}

function RunsPanel({
  runs,
  meta,
  onRunClick,
}: {
  runs: ProjectRun[];
  meta: string;
  onRunClick?: ((run: ProjectRun) => void) | undefined;
}) {
  return (
    <section className={`${styles.detailPanel} ${styles.runsPanel}`}>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="running" size={15} />项目运行
        </h2>
        <span>{meta}</span>
      </div>
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          className={styles.runRow}
          onClick={() => onRunClick?.(run)}
        >
          <span className={`${styles.stateDot} ${stateDotClass(run.status)}`} />
          <strong className={styles.runName}>{run.name}</strong>
          <small className={styles.runOwner}>{run.owner}</small>
          <em className={styles.runMeta}>{run.meta}</em>
        </button>
      ))}
    </section>
  );
}

function ArtifactsPanel({
  artifacts,
  onArtifactClick,
}: {
  artifacts: ProjectArtifact[];
  onArtifactClick?: ((artifact: ProjectArtifact) => void) | undefined;
}) {
  return (
    <section className={styles.detailPanel}>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="package" size={15} />产物
        </h2>
        <span>{artifacts.length} files</span>
      </div>
      {artifacts.map((a) => (
        <button
          key={a.id}
          type="button"
          className={styles.artifactRow}
          onClick={() => onArtifactClick?.(a)}
        >
          <DesignFileIcon className={styles.fileIcon} name={a.name} type={a.type} />
          <span className={styles.artifactName}>{a.name}</span>
        </button>
      ))}
    </section>
  );
}

function FeedPanel({ feed }: { feed: ProjectFeedItem[] }) {
  return (
    <section className={`${styles.detailPanel} ${styles.feedPanel}`}>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="notes" size={15} />最近动态
        </h2>
        <span>Today</span>
      </div>
      {feed.map((item) => (
        <div key={item.id} className={styles.feedRow}>
          <time className={styles.feedTime}>{item.time}</time>
          <span>{item.text}</span>
        </div>
      ))}
    </section>
  );
}

function ProjectDetail({
  project,
  activeTab,
  onEditAnnouncement,
  onRunClick,
  onArtifactClick,
}: {
  project: ProjectInfo;
  activeTab: ProjectTab;
  onEditAnnouncement?: ((projectId: string) => void) | undefined;
  onRunClick?: ((projectId: string, run: ProjectRun) => void) | undefined;
  onArtifactClick?: ((projectId: string, artifact: ProjectArtifact) => void) | undefined;
}) {
  // Only overview tab renders the full detail layout
  if (activeTab !== 'overview') {
    return null;
  }

  return (
    <div className={styles.detailLayout}>
      <Announcement
        text={project.announcement}
        onEdit={() => onEditAnnouncement?.(project.id)}
      />
      <MembersCard members={project.members} />
      <RunsPanel
        runs={project.runs}
        meta={project.meta}
        onRunClick={(run) => onRunClick?.(project.id, run)}
      />
      <ArtifactsPanel
        artifacts={project.artifacts}
        onArtifactClick={(a) => onArtifactClick?.(project.id, a)}
      />
      <FeedPanel feed={project.feed} />
    </div>
  );
}

// ── Main component ──

export function ProjectsPage({
  projects,
  activeProjectId,
  onProjectSelect,
  searchQuery = '',
  onSearchChange,
  activeFilter,
  onFilterChange,
  activeTab,
  onTabChange,
  onNewProject,
  onEditAnnouncement,
  onRunClick,
  onArtifactClick,
}: ProjectsPageProps): React.ReactElement {
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;

  return (
    <section className={styles.page}>
      {/* ── Left nav ── */}
      <aside className={styles.nav}>
        <div className={styles.navTitle}>项目</div>
        <input
          className={styles.search}
          placeholder="搜索项目"
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
        />
        <div className={styles.navCaption}>项目空间</div>
        {projects.map((project) => (
          <ProjectNavRow
            key={project.id}
            project={project}
            isActive={project.id === activeProjectId}
            onSelect={onProjectSelect}
          />
        ))}
        <div className={styles.navCaption}>视图</div>
        <FilterList activeFilter={activeFilter} onFilterChange={onFilterChange} />
      </aside>

      {/* ── Right main ── */}
      <main className={styles.main}>
        {activeProject ? (
          <>
            <div className={styles.detailHead}>
              <div>
                <h1>{activeProject.name}</h1>
                <p>
                  {activeProject.description} · {activeProject.meta}
                </p>
              </div>
              <div className={styles.headActions}>
                <span className={styles.statusBadge}>
                  {activeProject.status}
                </span>
                <button
                  type="button"
                  className={styles.newProjectBtn}
                  onClick={onNewProject}
                >
                  新建项目
                </button>
              </div>
            </div>
            <ProjectTabs activeTab={activeTab} onTabChange={onTabChange} />
            <ProjectDetail
              project={activeProject}
              activeTab={activeTab}
              onEditAnnouncement={onEditAnnouncement}
              onRunClick={onRunClick}
              onArtifactClick={onArtifactClick}
            />
          </>
        ) : (
          <div className={styles.detailHead}>
            <div>
              <h1>暂无项目</h1>
              <p>创建第一个项目以开始协作。</p>
            </div>
            <div className={styles.headActions}>
              <button
                type="button"
                className={styles.newProjectBtn}
                onClick={onNewProject}
              >
                新建项目
              </button>
            </div>
          </div>
        )}
      </main>
    </section>
  );
}
