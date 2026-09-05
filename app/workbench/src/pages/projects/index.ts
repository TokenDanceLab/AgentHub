/* ═══ Projects page subview barrel exports ═══ */

export {
  ProjectNavRow,
  ProjectTabs,
  ProjectEditor,
} from './ProjectChromeViews';

export { ProjectDetail } from './ProjectPanelViews';

export { ProjectNav } from './ProjectNav';
export type { ProjectNavProps } from './ProjectNav';

export { ProjectMain } from './ProjectMain';
export type { ProjectMainProps } from './ProjectMain';

export { useProjectEditor } from './useProjectEditor';

export {
  stateDotClass,
  runStatusLabel,
  artifactTypeLabel,
  runCount,
  projectSubmitErrorMessage,
} from './shared';
export { DEFAULT_PROJECTS, TAB_ITEMS } from './types';

export type {
  ProjectRunStatus,
  ProjectRun,
  ProjectArtifact,
  ProjectFeedItem,
  ProjectInfo,
  ProjectDraft,
  ProjectTab,
  ProjectsPageProps,
} from './types';
