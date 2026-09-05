export { AgentHubWorkbench } from './AgentHubWorkbench';
export { ChatViewBridge } from './ChatViewBridge';
export { ConversationSidebar } from './ConversationSidebar';
export { GlobalRail } from './GlobalRail';
export { RightInspector } from './RightInspector';
export { UnifiedComposer } from './UnifiedComposer';
export { WorkbenchGoalBanner } from './WorkbenchGoalBanner';
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
export {
  buildActiveConversationAttention,
  deriveConversationLiveStatus,
  findFirstAwaitingConversationId,
  isRunActive,
  summarizeWorkbenchAttention,
} from './workbenchAttentionModel';
export { GOAL_TOOL_NAMES, deriveGoalSummary } from './workbenchGoalSummary';
export type { TranscriptContextMenuEvent, TranscriptPointerEvent } from './transcriptEventTypes';
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
  ActiveConversationAttentionInput,
  ConversationLiveStatus,
  WorkbenchAttentionCounts,
  WorkbenchAttentionInput,
  WorkbenchAttentionSummary,
} from './workbenchAttentionModel';
export type { WorkbenchGoalBannerProps } from './WorkbenchGoalBanner';
export type { WorkbenchGoalStatus, WorkbenchGoalSummary } from './workbenchGoalSummary';
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
  DevicesPage,
  TokenUsagePage,
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
  DevicesPageProps,
  DevicesPageTarget,
  DevicesSummary,
  TokenUsagePageProps,
  TokenUsagePageTeam,
  TokenUsagePageRun,
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

/* ═══ Terminal host shell (#1174) ═══ */
export {
  TerminalPanel,
  isLocalTerminalEnabled,
} from './terminal';
export type {
  TerminalPanelLabels,
  TerminalPanelProps,
} from './terminal';

/* ═══ Floating components ═══ */
export {
  ContextMenu,
  MultiSelectBar,
  PersonPanel,
  ProfilePopover,
  DemoToast,
} from './floating';
export type {
  ContextMenuProps,
  ContextMenuItem,
  MultiSelectBarProps,
  MultiSelectBarAction,
  PersonPanelProps,
  ProfilePopoverProps,
  DemoToastProps,
} from './floating';

export * from './auxPanel';

export * from './sessionImport';

/* ═══ Team subagent stream (#1478 Phase C / #1406 Phase 2) ═══ */
export {
  createSubagentStreamStore,
  getSubagentStreamStore,
  SubagentStreamOverlay,
  type SubagentStreamState,
  type SubagentStreamStore,
  type SubagentStreamListener,
  type TeamSubagentStreamEvent,
  type SubagentStreamOverlayProps,
} from './team';

/* ═══ Inline message delegation (#1406 Phase 3) ═══ */
export {
  InlineDelegationCard,
  type InlineDelegationCardProps,
  createMessageDelegationStore,
  getMessageDelegationStore,
  type MessageDelegationStore,
  type MessageDelegationState,
  type DelegationEntry,
  type DelegationStatus,
  type MessageDelegationListener,
} from './team';
