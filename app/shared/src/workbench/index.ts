export { AgentHubWorkbench } from './AgentHubWorkbench';
export { ChatViewBridge } from './ChatViewBridge';
export { ConversationSidebar } from './ConversationSidebar';
export { GlobalRail } from './GlobalRail';
export { RightInspector } from './RightInspector';
export { UnifiedComposer } from './UnifiedComposer';
export { WorkbenchRoutes } from './WorkbenchRoutes';
export { WorkspaceHeader } from './WorkspaceHeader';
export {
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_READABLE_WIDTH,
  INSPECTOR_COLLAPSE_SNAP_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_COLLAPSE_SNAP_WIDTH,
  WORKSPACE_AUTO_COLLAPSE_WIDTH,
} from './workbenchLayoutConstants';
export {
  buildMainchainSummary,
  runtimeEvidenceSourceSummary,
} from './mainchain';
export { MainchainStatusStrip } from './MainchainStatusStrip';
export type { TranscriptContextMenuEvent, TranscriptPointerEvent } from './transcriptEventTypes';
export * from './mockData';
export {
  buildAgentCapabilityContractFromConfig,
  buildAgentCapabilitySummary,
  validateAgentCapabilityContract,
} from './agentCapabilities';
export type {
  AgentCapabilityContract,
  AgentCapabilityRef,
  AgentCapabilityStatus,
  AgentCapabilitySummary,
  AgentMemoryPolicy,
  AgentMemoryRetention,
} from './agentCapabilities';
export {
  AGENT_PROFILE_CATALOG,
  WORKBENCH_AGENT_MARKET_FIXTURES,
  WORKBENCH_AGENT_MCP_OPTIONS,
  WORKBENCH_AGENT_MODELS,
  WORKBENCH_AGENT_MODEL_HEALTH,
  WORKBENCH_AGENT_POLICY_RULES,
  WORKBENCH_AGENT_PROFILE_FIXTURES,
  WORKBENCH_AGENT_SKILL_OPTIONS,
  WORKBENCH_AGENT_TOOL_OPTIONS,
  agentConfigToAgentSpecFixture,
  agentProfileCatalogToConfig,
  agentProfileCatalogToMarketTemplate,
} from './agentProfileCatalog';
export type {
  AgentApprovalMode,
  AgentMemorySource,
  AgentProfileCatalogItem,
  AgentProfileVisibility,
  AgentRuntimeId,
  AgentTargetPreference,
} from './agentProfileCatalog';
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
export {
  RuntimeBrandIcon,
  resolveRuntimeBrandIcon,
} from './RuntimeBrandIcon';

/* ── Types ── */
export type { AgentHubWorkbenchProps } from './AgentHubWorkbench';
export type { ChatViewBridgeProps } from './ChatViewBridge';
export type { ConversationSidebarProps } from './ConversationSidebar';
export type { GlobalRailProps, GlobalRailPage, ConnectionStatusKind } from './GlobalRail';
export type { RightInspectorProps, RuntimeEvidenceSnapshot } from './RightInspector';
export type { UnifiedComposerProps } from './UnifiedComposer';
export type {
  MainchainNode,
  MainchainSummary,
  MainchainStatusKind,
  MainchainWorkbenchStatus,
} from './mainchain';
export type { MainchainStatusStripProps } from './MainchainStatusStrip';
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
export type {
  RuntimeBrandIconKind,
  RuntimeBrandIconProps,
  RuntimeBrandIconResolution,
  RuntimeBrandIconSize,
  RuntimeBrandIconSource,
} from './RuntimeBrandIcon';

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
  SkillMarketItem,
  MCPMarketItem,
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
  ProjectDraft,
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

export * from './auxPanel';
