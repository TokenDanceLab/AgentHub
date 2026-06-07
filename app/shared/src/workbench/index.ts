export { AgentHubWorkbench } from './AgentHubWorkbench';
export { ConversationSidebar } from './ConversationSidebar';
export { GlobalRail } from './GlobalRail';
export { RightInspector } from './RightInspector';
export { TranscriptView } from './TranscriptView';
export { UnifiedComposer } from './UnifiedComposer';
export { WorkbenchRoutes } from './WorkbenchRoutes';
export { WorkspaceHeader } from './WorkspaceHeader';
export * from './mockData';
export {
  DESIGN_FILE_ICON_RADIUS,
  DESIGN_FILE_ICON_SIZE,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  DESIGN_NAV_ICON_SIZE,
  DESIGN_NAV_ICON_STROKE_WIDTH,
  DesignFileIcon,
  DesignNavIcon,
  getDesignFileIconColor,
  getDesignFileIconType,
  profileActionIconName,
} from './designIcons';

/* ── Types ── */
export type { AgentHubWorkbenchProps } from './AgentHubWorkbench';
export type { ConversationSidebarProps } from './ConversationSidebar';
export type { GlobalRailProps, GlobalRailPage } from './GlobalRail';
export type { RightInspectorProps } from './RightInspector';
export type { TranscriptViewProps } from './TranscriptView';
export type { UnifiedComposerProps } from './UnifiedComposer';
export type {
  WorkbenchAgentProfilesStatus,
  WorkbenchContactsData,
  WorkbenchRoutesProps,
} from './WorkbenchRoutes';
export type { WorkspaceHeaderProps } from './WorkspaceHeader';
export type {
  DesignFileIconType,
  DesignNavIconName,
} from './designIcons';

/* ═══ Pages ═══ */
export {
  AgentsPage,
  ContactsPage,
  DocsPage,
  ProjectsPage,
  DEFAULT_PROJECTS,
  SettingsPage,
  TasksPage,
} from './pages';
export type {
  AgentsPageProps,
  AgentConfig,
  AgentsPaneId,
  AgentState,
  ToolPermission,
  RiskLevel,
  ModelState,
  ContactsPageProps,
  ContactMember,
  ContactGroup,
  ServiceDesk,
  ContactsPane,
  ContactModalTab,
  DocsPageProps,
  DocRow,
  DocsPane,
  DocsPageNavItem,
  ProjectsPageProps,
  ProjectInfo,
  ProjectRun,
  ProjectArtifact,
  ProjectFeedItem,
  ProjectRunStatus,
  ProjectFilter,
  ProjectTab,
  SettingsPageProps,
  SettingsPaneId,
  StatePanelKind,
  TasksPageProps,
  TaskItem,
  TaskGroup,
  TaskStatus,
  TasksPane,
  ViewMode,
} from './pages';

/* ═══ Blocks ═══ */
export {
  AgentMessage,
  UserMessage,
  ToolCardBlock,
  TOOL_STATUS_LABELS,
  FileChangeCard,
  DiffCard,
  DateDivider,
  PinnedAnnouncement,
  ApprovalCardBlock,
  ThinkingBlock,
  SubagentBlock,
  ChildAgentBlock,
  RunSessionCard,
  ResultBlock,
  RouteDecisionBlock,
  STATUS_LABELS,
  ContextUsageBlock,
  AgentTimeline,
} from './blocks';
export type {
  AgentMessageProps,
  UserMessageProps,
  ToolCardBlockProps,
  FileChangeCardProps,
  DiffCardProps,
  DateDividerProps,
  PinnedAnnouncementProps,
  ApprovalCardBlockProps,
  ThinkingBlockProps,
  SubagentBlockProps,
  ChildAgentBlockProps,
  RunSessionCardProps,
  ResultBlockProps,
  RouteDecisionBlockProps,
  ContextUsageBlockProps,
  AgentTimelineProps,
} from './blocks';

/* ═══ Inspector panels ═══ */
export {
  OverviewPanel,
  FilePreview,
  BrowserPreview,
} from './inspector';
export type {
  OverviewPanelProps,
  TaskItem as InspectorTaskItem,
  FileItem,
  FilePreviewProps,
  BrowserPreviewProps,
} from './inspector';

/* ═══ Floating components ═══ */
export {
  ContextMenu,
  MultiSelectBar,
  PersonPanel,
  ProfilePopover,
  Toast,
} from './floating';
export type {
  ContextMenuProps,
  ContextMenuItem,
  MultiSelectBarProps,
  MultiSelectBarAction,
  PersonPanelProps,
  ProfilePopoverProps,
  ToastProps,
} from './floating';
