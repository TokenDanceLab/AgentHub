/* ═══ Projects page subview barrel exports ═══ */

export {
  ProjectNavRow,
  FilterList,
  ProjectTabs,
  ProjectDetail,
  ProjectEditor,
} from './ProjectDetailViews';

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

export { DEFAULT_PROJECTS, FILTER_ITEMS, TAB_ITEMS } from './types';

export type {
  ProjectRunStatus,
  ProjectRun,
  ProjectArtifact,
  ProjectFeedItem,
  ProjectInfo,
  ProjectDraft,
  ProjectFilter,
  ProjectTab,
  ProjectsPageProps,
} from './types';
