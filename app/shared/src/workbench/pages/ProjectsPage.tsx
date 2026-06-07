import React, { useCallback } from 'react';
import {
  DesignFileIcon,
  DesignNavIcon,
  type DesignNavIconName,
} from '../designIcons';
import type { WorkbenchDocumentPreview } from '../documentPreview';
import { FilePreview } from '../inspector';
import {
  resolveWorkbenchProfile,
  type WorkbenchProfileSource,
} from '../profileRegistry';
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
  /** Agent/user profiles available for avatar resolution */
  profiles?: WorkbenchProfileSource[] | undefined;
  /** Currently selected project artifact preview */
  activePreview?: WorkbenchDocumentPreview | null | undefined;
  /** Called when project artifact preview closes */
  onClosePreview?: (() => void) | undefined;
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
      return styles.stateRunning ?? '';
    case 'completed':
      return styles.stateCompleted ?? '';
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

function runStatusLabel(status: ProjectRunStatus): string {
  switch (status) {
    case 'running':
      return '运行中';
    case 'thinking':
      return '思考中';
    case 'waiting':
      return '待启动';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function artifactTypeLabel(type: string): string {
  const lowerType = type.toLowerCase();
  switch (lowerType) {
    case 'md':
      return 'Markdown';
    case 'xlsx':
      return '表格';
    case 'ts':
    case 'tsx':
      return 'TypeScript';
    case 'js':
    case 'jsx':
      return 'JavaScript';
    case 'css':
      return '样式';
    case 'html':
      return '页面';
    default:
      return lowerType.toUpperCase();
  }
}

function runCount(runs: ProjectRun[], statuses: ProjectRunStatus[]): number {
  return runs.filter((run) => statuses.includes(run.status)).length;
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
    <section className={`${styles.announcement} project-announcement`} data-card-surface>
      <span className={styles.announcementMark} />
      <div className={styles.announcementBody}>
        <strong className={styles.announcementLabel}>
          <DesignNavIcon name="notes" size={15} />项目公告
        </strong>
        <p className={styles.announcementText}>{text}</p>
      </div>
      {onEdit ? (
        <button
          type="button"
          className={styles.announcementEditBtn}
          onClick={onEdit}
        >
          编辑
        </button>
      ) : null}
    </section>
  );
}

function MembersCard({
  members,
  profiles = [],
}: {
  members: string[];
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  return (
    <section className={`${styles.membersCard} project-members-card`} data-card-surface>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="users" size={15} />成员
        </h2>
        <span>{members.length} people</span>
      </div>
      <div className={`${styles.memberChips} project-members`}>
        {members.map((name) => {
          const profile = resolveWorkbenchProfile(name, profiles);
          return (
            <span
              key={name}
              className={styles.memberChip}
              data-profile-kind={profile.kind}
              title={`${profile.name} · ${profile.label}`}
            >
              <span
                className={styles.memberAvatar}
                style={{ '--member-avatar-color': profile.color } as React.CSSProperties}
              >
                {profile.initials}
              </span>
              <span className={styles.memberName}>{profile.name}</span>
              <em className={styles.memberKind}>{profile.label}</em>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function ProjectProfilePill({
  name,
  profiles = [],
}: {
  name: string;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  const profile = resolveWorkbenchProfile(name, profiles);
  return (
    <span className={styles.profilePill} data-profile-kind={profile.kind}>
      <span
        className={styles.profileAvatar}
        style={{ '--profile-avatar-color': profile.color } as React.CSSProperties}
      >
        {profile.initials}
      </span>
      <span className={styles.profileName}>{profile.name}</span>
    </span>
  );
}

function RunsPanel({
  runs,
  meta,
  onRunClick,
  profiles = [],
}: {
  runs: ProjectRun[];
  meta: string;
  onRunClick?: ((run: ProjectRun) => void) | undefined;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  return (
    <section className={`${styles.detailPanel} ${styles.runsPanel} project-detail-panel project-runs-panel`} data-card-surface>
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
          className={`${styles.runRow} project-run`}
          data-card-surface
          onClick={() => onRunClick?.(run)}
        >
          <span className={`${styles.stateDot} ${stateDotClass(run.status)}`} />
          <strong className={styles.runName}>{run.name}</strong>
          <ProjectProfilePill name={run.owner} profiles={profiles} />
          <em className={styles.runMeta}>{run.meta}</em>
        </button>
      ))}
    </section>
  );
}

function RunSummaryPanel({ project }: { project: ProjectInfo }) {
  const running = runCount(project.runs, ['running', 'thinking']);
  const completed = runCount(project.runs, ['completed']);
  const waiting = runCount(project.runs, ['waiting']);

  return (
    <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="grid" size={15} />运行摘要
        </h2>
        <span>{project.runs.length} total</span>
      </div>
      <div className={styles.summaryRows}>
        <div className={styles.summaryRow}>
          <span className={`${styles.stateDot} ${styles.stateRunning}`} />
          <strong>活跃运行</strong>
          <em>{running}</em>
        </div>
        <div className={styles.summaryRow}>
          <span className={`${styles.stateDot} ${styles.stateCompleted}`} />
          <strong>已完成</strong>
          <em>{completed}</em>
        </div>
        <div className={styles.summaryRow}>
          <span className={`${styles.stateDot} ${styles.stateWaiting}`} />
          <strong>等待队列</strong>
          <em>{waiting}</em>
        </div>
      </div>
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
    <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
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
          className={`${styles.artifactRow} project-artifact`}
          data-card-surface
          onClick={() => onArtifactClick?.(a)}
        >
          <DesignFileIcon className={styles.fileIcon} name={a.name} type={a.type} />
          <span className={styles.artifactName}>{a.name}</span>
        </button>
      ))}
    </section>
  );
}

function ArtifactIndexPanel({ artifacts }: { artifacts: ProjectArtifact[] }) {
  return (
    <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="notes" size={15} />产物索引
        </h2>
        <span>{artifacts.length} entries</span>
      </div>
      {artifacts.map((artifact, index) => (
        <div key={artifact.id} className={styles.metaRow}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <strong>{artifactTypeLabel(artifact.type)}</strong>
          <em>{artifact.name}</em>
        </div>
      ))}
    </section>
  );
}

function FeedPanel({ feed }: { feed: ProjectFeedItem[] }) {
  return (
    <section className={`${styles.detailPanel} ${styles.feedPanel} project-detail-panel`} data-card-surface>
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

function ProjectPreviewPanel({
  preview,
  onClosePreview,
}: {
  preview?: WorkbenchDocumentPreview | null | undefined;
  onClosePreview?: (() => void) | undefined;
}) {
  if (!preview) return null;

  return (
    <section className={`${styles.previewPanel} project-preview-panel`} data-card-surface>
      <div className={styles.previewHead}>
        <div>
          <span>{preview.sourceLabel}</span>
          <strong>{preview.name}</strong>
        </div>
        <em>项目产物预览</em>
      </div>
      <FilePreview
        filename={preview.name}
        owner={preview.owner}
        language={preview.type}
        content={preview.content}
        diffContent={preview.diffContent}
        onClose={onClosePreview ?? (() => {})}
      />
    </section>
  );
}

function RunsTab({
  project,
  onRunClick,
  profiles = [],
}: {
  project: ProjectInfo;
  onRunClick?: ((projectId: string, run: ProjectRun) => void) | undefined;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  return (
    <div className={styles.detailLayout}>
      <RunsPanel
        runs={project.runs}
        meta={project.meta}
        profiles={profiles}
        onRunClick={(run) => onRunClick?.(project.id, run)}
      />
      <RunSummaryPanel project={project} />
      <section className={`${styles.detailPanel} ${styles.feedPanel} project-detail-panel project-feed`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="notes" size={15} />运行记录
          </h2>
          <span>Recent</span>
        </div>
        {project.runs.map((run) => (
          <div key={run.id} className={styles.feedRow}>
            <time className={styles.feedTime}>{runStatusLabel(run.status)}</time>
            <span>
              {run.owner} 负责 {run.name}，当前进度 {run.meta}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

function ArtifactsTab({
  project,
  onArtifactClick,
  activePreview,
  onClosePreview,
}: {
  project: ProjectInfo;
  onArtifactClick?: ((projectId: string, artifact: ProjectArtifact) => void) | undefined;
  activePreview?: WorkbenchDocumentPreview | null | undefined;
  onClosePreview?: (() => void) | undefined;
}) {
  return (
    <div className={styles.detailLayout}>
      <ArtifactsPanel
        artifacts={project.artifacts}
        onArtifactClick={(artifact) => onArtifactClick?.(project.id, artifact)}
      />
      <ArtifactIndexPanel artifacts={project.artifacts} />
      <section className={`${styles.detailPanel} ${styles.feedPanel} project-detail-panel project-feed`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="package" size={15} />交付动态
          </h2>
          <span>{project.artifacts.length} files</span>
        </div>
        {project.artifacts.map((artifact) => (
          <div key={artifact.id} className={styles.feedRow}>
            <time className={styles.feedTime}>{artifact.type}</time>
            <span>{artifact.name} 已进入当前项目产物列表</span>
          </div>
        ))}
      </section>
      <ProjectPreviewPanel preview={activePreview} onClosePreview={onClosePreview} />
    </div>
  );
}

function ArchiveTab({ project }: { project: ProjectInfo }) {
  const completed = runCount(project.runs, ['completed']);
  const active = runCount(project.runs, ['running', 'thinking', 'waiting']);
  const archiveItems = [
    { id: 'runs', label: '运行记录', value: `${completed}/${project.runs.length} 完成`, status: active > 0 ? '待确认' : '可归档' },
    { id: 'artifacts', label: '产物索引', value: `${project.artifacts.length} files`, status: '已整理' },
    { id: 'members', label: '成员确认', value: `${project.members.length} people`, status: project.status },
  ];

  return (
    <div className={styles.detailLayout}>
      <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="archive" size={15} />归档检查
          </h2>
          <span>{archiveItems.length} checks</span>
        </div>
        {archiveItems.map((item) => (
          <div key={item.id} className={styles.archiveRow}>
            <span className={`${styles.stateDot} ${item.status === '可归档' || item.status === '已整理' ? styles.stateCompleted : styles.stateWaiting}`} />
            <strong>{item.label}</strong>
            <small>{item.value}</small>
            <em>{item.status}</em>
          </div>
        ))}
      </section>
      <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="package" size={15} />归档包
          </h2>
          <span>Draft</span>
        </div>
        <button type="button" className={`${styles.artifactRow} project-artifact`} data-card-surface>
          <DesignFileIcon className={styles.fileIcon} name={`${project.id}-handoff.md`} type="md" />
          <span className={styles.artifactName}>{project.id}-handoff.md</span>
        </button>
        <button type="button" className={`${styles.artifactRow} project-artifact`} data-card-surface>
          <DesignFileIcon className={styles.fileIcon} name={`${project.id}-manifest.xlsx`} type="xlsx" />
          <span className={styles.artifactName}>{project.id}-manifest.xlsx</span>
        </button>
      </section>
      <FeedPanel feed={project.feed} />
    </div>
  );
}

function ProjectMembers({
  members,
  profiles = [],
}: {
  members: string[];
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  return (
    <div className={`${styles.memberChips} project-members`}>
      {members.map((name) => {
        const profile = resolveWorkbenchProfile(name, profiles);
        return (
          <span
            key={name}
            className={styles.memberChip}
            data-profile-kind={profile.kind}
            title={`${profile.name} · ${profile.label}`}
          >
            <span
              className={styles.memberAvatar}
              style={{ '--member-avatar-color': profile.color } as React.CSSProperties}
            >
              {profile.initials}
            </span>
            <span className={styles.memberName}>{profile.name}</span>
            <em className={styles.memberKind}>{profile.label}</em>
          </span>
        );
      })}
    </div>
  );
}

function SettingsTab({
  project,
  profiles = [],
}: {
  project: ProjectInfo;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  const settings = [
    { label: '项目名称', value: project.name, meta: project.id },
    { label: '当前状态', value: project.status, meta: project.meta },
    { label: '默认 Agent', value: project.runs[0]?.owner ?? 'Orchestrator', meta: '运行入口' },
    { label: '成员策略', value: `${project.members.length} 人协作`, meta: '项目空间' },
    { label: '归档策略', value: project.status.includes('归档') ? '归档确认' : '运行完成后归档', meta: '自动整理' },
  ];

  return (
    <div className={styles.detailLayout}>
      <Announcement
        text={project.announcement}
        onEdit={undefined}
      />
      <section className={`${styles.detailPanel} ${styles.settingsPanel} project-detail-panel`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="tools" size={15} />项目设置
          </h2>
          <span>{settings.length} items</span>
        </div>
        {settings.map((item) => (
          <div key={item.label} className={styles.settingRow}>
            <div>
              <strong>{item.label}</strong>
              <small>{item.meta}</small>
            </div>
            <span>{item.value}</span>
          </div>
        ))}
      </section>
      <section className={`${styles.detailPanel} ${styles.settingsSidePanel} project-detail-panel`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="users" size={15} />成员策略
          </h2>
          <span>{project.members.length} people</span>
        </div>
        <ProjectMembers members={project.members} profiles={profiles} />
      </section>
    </div>
  );
}

function ProjectDetail({
  project,
  activeTab,
  onEditAnnouncement,
  onRunClick,
  onArtifactClick,
  profiles,
  activePreview,
  onClosePreview,
}: {
  project: ProjectInfo;
  activeTab: ProjectTab;
  onEditAnnouncement?: ((projectId: string) => void) | undefined;
  onRunClick?: ((projectId: string, run: ProjectRun) => void) | undefined;
  onArtifactClick?: ((projectId: string, artifact: ProjectArtifact) => void) | undefined;
  profiles?: WorkbenchProfileSource[] | undefined;
  activePreview?: WorkbenchDocumentPreview | null | undefined;
  onClosePreview?: (() => void) | undefined;
}) {
  switch (activeTab) {
    case 'runs':
      return <RunsTab project={project} profiles={profiles} onRunClick={onRunClick} />;
    case 'artifacts':
      return (
        <ArtifactsTab
          project={project}
          activePreview={activePreview}
          onArtifactClick={onArtifactClick}
          onClosePreview={onClosePreview}
        />
      );
    case 'archive':
      return <ArchiveTab project={project} />;
    case 'settings':
      return <SettingsTab project={project} profiles={profiles} />;
    case 'overview':
    default:
      break;
  }

  return (
    <div className={styles.detailLayout}>
      <Announcement
        text={project.announcement}
        onEdit={() => onEditAnnouncement?.(project.id)}
      />
      <MembersCard members={project.members} profiles={profiles} />
      <RunsPanel
        runs={project.runs}
        meta={project.meta}
        profiles={profiles}
        onRunClick={(run) => onRunClick?.(project.id, run)}
      />
      <ArtifactsPanel
        artifacts={project.artifacts}
        onArtifactClick={(a) => onArtifactClick?.(project.id, a)}
      />
      <FeedPanel feed={project.feed} />
      <ProjectPreviewPanel preview={activePreview} onClosePreview={onClosePreview} />
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
  profiles,
  activePreview,
  onClosePreview,
  onEditAnnouncement,
  onRunClick,
  onArtifactClick,
}: ProjectsPageProps): React.ReactElement {
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;

  return (
    <section className={`${styles.page} workbench projects-page`}>
      {/* ── Left nav ── */}
      <aside className={`${styles.nav} workbench-nav project-nav`}>
        <div className={styles.navHeader}>
          <div className={`${styles.navTitle} workbench-title`}>项目</div>
          <button
            type="button"
            className={`${styles.newProjectBtn} ${styles.navNewProjectBtn} outline-action`}
            onClick={onNewProject}
          >
            新建项目
          </button>
        </div>
        <input
          className={`${styles.search} workbench-search`}
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
      <main className={`${styles.main} workbench-main`}>
        {activeProject ? (
          <>
            <div className={`${styles.detailHead} workbench-head`}>
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
              </div>
            </div>
            <ProjectTabs activeTab={activeTab} onTabChange={onTabChange} />
            <ProjectDetail
              project={activeProject}
              activeTab={activeTab}
              onEditAnnouncement={onEditAnnouncement}
              onRunClick={onRunClick}
              onArtifactClick={onArtifactClick}
              profiles={profiles}
              activePreview={activePreview}
              onClosePreview={onClosePreview}
            />
          </>
        ) : (
          <div className={`${styles.detailHead} workbench-head`}>
            <div>
              <h1>暂无项目</h1>
              <p>创建第一个项目以开始协作。</p>
            </div>
            <div className={styles.headActions}>
              <span className={styles.statusBadge}>空项目</span>
            </div>
          </div>
        )}
      </main>
    </section>
  );
}
