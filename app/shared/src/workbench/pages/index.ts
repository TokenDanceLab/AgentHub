/* ═══ Pages barrel exports ═══ */

export { AgentsPage } from './AgentsPage';
export type { AgentsPageProps, AgentsPaneId, AgentState, ToolPermission, RiskLevel, ModelState } from './AgentsPage';

export { ContactsPage } from './ContactsPage';
export type {
  ContactsPageProps,
  ContactMember,
  ContactGroup,
  ServiceDesk,
  ContactsPane,
  ContactModalTab,
} from './ContactsPage';

export { DocsPage } from './DocsPage';
export type { DocsPageProps, DocRow, DocsPane, DocsPageNavItem } from './DocsPage';

export { ProjectsPage, DEFAULT_PROJECTS } from './ProjectsPage';
export type {
  ProjectsPageProps,
  ProjectInfo,
  ProjectRun,
  ProjectArtifact,
  ProjectFeedItem,
  ProjectRunStatus,
  ProjectFilter,
  ProjectTab,
} from './ProjectsPage';

export { SettingsPage } from './SettingsPage';
export type {
  SettingsPageProps,
  SettingsPaneId,
  StatePanelKind,
} from './SettingsPage';

export { TasksPage } from './TasksPage';
export type {
  TasksPageProps,
  TaskItem,
  TaskGroup,
  TaskStatus,
  TaskEditDraft,
  TasksPane,
  ViewMode,
} from './TasksPage';
