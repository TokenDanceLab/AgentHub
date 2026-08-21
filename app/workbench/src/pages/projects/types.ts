/* ═══════════════════════════════════════════════════════════════════════
   Projects page public types — extracted for Phase 17 strangler slice #562.
   ═══════════════════════════════════════════════════════════════════════ */

import type { WorkbenchDocumentPreview } from '../../documentPreview';
import type { DesignNavIconName } from '../../designIcons';
import type { FolderThemeColor } from '@shared/folderThemeColors';
import type { WorkbenchProfileSource } from '../../profileRegistry';

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
  /**
   * Per-folder accent color key. When set, the active folder drives the
   * `--td-accent` token family (chrome/border/badge tint) via the
   * `data-folder-accent` attribute on <html>. Undefined falls back to the
   * product default (--primary). See folderThemeColors.ts SSOT.
   */
  themeColor?: FolderThemeColor;
  members: string[];
  announcement: string;
  runs: ProjectRun[];
  artifacts: ProjectArtifact[];
  feed: ProjectFeedItem[];
}

export interface ProjectDraft {
  name: string;
  description: string;
  /**
   * Per-folder accent color chosen in the editor palette picker. Carried
   * through the create/update draft so the owning shell can persist it onto
   * ProjectInfo.themeColor. Undefined falls back to the product default
   * (--primary). See folderThemeColors.ts SSOT.
   */
  themeColor?: FolderThemeColor;
}

export type ProjectFilter = 'all' | 'running' | 'completed' | 'archived';

export type ProjectTab = 'overview' | 'runs' | 'artifacts' | 'archive' | 'settings';

export interface ProjectsPageProps {
  /** Full list of projects (shown in left nav) */
  projects: ProjectInfo[];
  /** True while the owning app is loading project data. */
  projectsLoading?: boolean | undefined;
  /** Error message from the owning app when project data fails to load. */
  projectsError?: string | undefined;
  /** True while a project create/update action is in flight. */
  projectSaving?: boolean | undefined;
  /** Error message from the owning app when create/update fails. */
  projectActionError?: string | undefined;
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
  /** Called when a project should be created. */
  onProjectCreate?: ((draft: ProjectDraft) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  /** Called when a project should be updated. */
  onProjectUpdate?: ((
    projectId: string,
    draft: ProjectDraft,
  ) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
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
  /** Whether more projects are available via pagination. */
  hasMore?: boolean | undefined;
  /** Whether a load-more page fetch is in flight. */
  loadingMore?: boolean | undefined;
  /** Triggered when the user scrolls near the bottom of the project list. */
  onLoadMore?: (() => void) | undefined;
  /** Visible load-more failure (#1546). When set, pagination stopped and `onLoadMore` acts as explicit retry. */
  loadMoreError?: string | undefined;
}

// ── Defaults / demo data ──

export const DEFAULT_PROJECTS: ProjectInfo[] = [
  {
    id: 'ai-game',
    name: 'AI 游戏项目',
    description: '深度研究团队 · 5 人',
    status: '研究中',
    meta: '3 runs',
    themeColor: 'emerald',
    members: ['当前用户', 'Johnny', 'Trump', 'Builder', 'Researcher'],
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
    themeColor: 'amber',
    members: ['当前用户', 'Johnny', 'Reviewer'],
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

export const FILTER_ITEMS: { id: ProjectFilter; labelKey: string; icon: DesignNavIconName }[] = [
  { id: 'all', labelKey: 'projects.nav.all', icon: 'grid' },
  { id: 'running', labelKey: 'projects.nav.running', icon: 'running' },
  { id: 'completed', labelKey: 'projects.nav.completed', icon: 'done' },
  { id: 'archived', labelKey: 'projects.nav.archived', icon: 'archive' },
];

export const TAB_ITEMS: { id: ProjectTab; labelKey: string; icon: DesignNavIconName }[] = [
  { id: 'overview', labelKey: 'projects.tab.overview', icon: 'home' },
  { id: 'runs', labelKey: 'projects.projectRuns', icon: 'running' },
  { id: 'artifacts', labelKey: 'inspector.artifacts', icon: 'package' },
  { id: 'archive', labelKey: 'projects.nav.archived', icon: 'archive' },
  { id: 'settings', labelKey: 'projects.tab.settings', icon: 'tools' },
];
