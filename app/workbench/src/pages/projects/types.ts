/* ═══════════════════════════════════════════════════════════════════════
   Projects page public types (#562).
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
}

export const TAB_ITEMS: { id: ProjectTab; labelKey: string; icon: DesignNavIconName }[] = [
  { id: 'overview', labelKey: 'projects.tab.overview', icon: 'home' },
  { id: 'runs', labelKey: 'projects.projectRuns', icon: 'running' },
  { id: 'artifacts', labelKey: 'inspector.artifacts', icon: 'package' },
  { id: 'archive', labelKey: 'projects.nav.archived', icon: 'archive' },
  { id: 'settings', labelKey: 'projects.tab.settings', icon: 'tools' },
];
