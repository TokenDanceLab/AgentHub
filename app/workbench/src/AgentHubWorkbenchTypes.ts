import type {
  AgentHubPlatform,
  WorkbenchAgent,
  WorkbenchConversation,
} from '@shared/platform';
import type { TranscriptBlock, ApprovalDecisionAction } from '@shared/transcript';
import type { ConnectionStatusKind } from './GlobalRail';
import type { RuntimeEvidenceSnapshot } from './RightInspector';
import type {
  WorkbenchAgentProfilesStatus,
  WorkbenchContactsData,
  WorkbenchContactsActions,
  WorkbenchDocumentsActions,
} from './WorkbenchRoutes';
import type { AgentConfig, ProjectDraft, DocRow } from './pages';
import type { SkillMarketItem, MCPMarketItem } from './pages/AgentsPage';
import type { ProjectInfo } from './pages/ProjectsPage';
import type { WorkbenchProjectsPort } from './workbenchProjectsPort';
import type { WorkbenchAttentionInput } from './workbenchAttentionModel';

/* ═══════════════════════════════════════════════════════════════════════
   AgentHubWorkbenchTypes — public props contract residual extract (#683).
   Pure types only; no React / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export interface AgentHubWorkbenchStatus {
  dataMode?: string;
  replayLabel?: string;
  targetLabel?: string;
  targetState?: string;
  /** Whether the workbench is loading initial data (threads/conversations not yet loaded). */
  initialLoading?: boolean;
  /** Error message from initial data load, if any. */
  loadError?: string;
}

export interface AgentHubWorkbenchProjectsStatus {
  loading?: boolean | undefined;
  error?: string | undefined;
  actionError?: string | undefined;
  saving?: boolean | undefined;
}

export interface AgentHubWorkbenchModelCatalogItem {
  id: string;
  label: string;
  value: string;
  provider?: string;
  status: string;
  description?: string;
  default?: boolean;
  tags?: string[];
}

export interface AgentHubWorkbenchProps {
  platform: AgentHubPlatform;
  conversations: WorkbenchConversation[];
  agents?: WorkbenchAgent[];
  composerExecutionTargets?: Array<{ id: string; label: string; healthy?: boolean }> | undefined;
  workbenchStatus?: AgentHubWorkbenchStatus | undefined;
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  contacts?: WorkbenchContactsData | undefined;
  /** Hub contacts request failure (#1821) — the contacts page must render an
   *  explicit error state instead of collapsing into an empty list. */
  contactsError?: string | undefined;
  projects?: ProjectInfo[] | undefined;
  activeProjectId?: string | undefined;
  projectsStatus?: AgentHubWorkbenchProjectsStatus | undefined;
  activeConversationId?: string;
  onActiveConversationChange?: ((conversationId: string) => void) | undefined;
  /** Called when the user toggles pin on a session. Parent should call Hub API and refresh. */
  onConversationPin?: ((conversationId: string, pinned: boolean) => void) | undefined;
  /** Called when the user toggles archive on a session. Parent should call Hub API and refresh. */
  onConversationArchive?: ((conversationId: string, archived: boolean) => void) | undefined;
  onActiveProjectChange?: ((projectId: string) => void) | undefined;
  onAgentCreate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentUpdate?: ((agent: AgentConfig) => Promise<void> | void) | undefined;
  onAgentDelete?: ((agentId: string) => Promise<void> | void) | undefined;
  onAgentsRetry?: (() => void) | undefined;
  onLogout?: (() => void) | undefined;
  onProjectCreate?: ((draft: ProjectDraft) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  onProjectUpdate?: ((
    projectId: string,
    draft: ProjectDraft,
  ) => Promise<ProjectInfo | void> | ProjectInfo | void) | undefined;
  /** Narrow domain port for project data access when onProjectCreate/Update are not provided (#1546). */
  projectsPort?: WorkbenchProjectsPort | undefined;
  onApprovalDecision?: ((action: ApprovalDecisionAction) => Promise<void> | void) | undefined;
  /** 用户想与某个联系人/Agent 开始私聊，但当前没有已有会话时触发。上层负责创建会话并切换。 */
  onNavigateToConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
  /** 会话侧边栏「新建会话」点击时触发（#1819）。上层负责调 createSession 链并切换；
   *  失败时上层以可见方式（toast/modal 错误）呈现，不吞错。 */
  onStartNewConversation?: (() => void) | undefined;
  /** Contact mutation actions passed through to ContactsPage. */
  contactsActions?: WorkbenchContactsActions | undefined;
  /** Document rows for DocsPage (real data first, mock fallback). */
  documents?: DocRow[] | undefined;
  /** Hub documents request failure (#1821) — the docs page must render an
   *  explicit error state instead of collapsing into an empty list. */
  documentsError?: string | undefined;
  /** Document mutation actions wired to Hub Documents API. */
  documentsActions?: WorkbenchDocumentsActions | undefined;
  /** Model catalog items from Edge API. When provided, the Agents page
   *  Models tab shows real model data instead of mock fixtures. */
  modelCatalog?: AgentHubWorkbenchModelCatalogItem[] | undefined;
  /** cc-switch transparent proxy status from Edge API. */
  ccSwitchStatus?: import('./pages/AgentsPage').CCSwitchStatusInfo | undefined;
  /** cc-switch provider model alias mappings. */
  ccSwitchProviders?: import('./pages/AgentsPage').CCSwitchProviderInfo[] | undefined;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  showComposerAgentPicker?: boolean | undefined;
  showComposerStatus?: boolean | undefined;
  showMainchainStatus?: boolean | undefined;
  transcript: TranscriptBlock[];
  /**
   * Optional unread-messages divider for the transcript (T8 desktop IM path).
   * The IM consumer (desktop Hub sessions) derives the anchor from the read
   * watermark (unread_count = next_seq − last_read_seq); absent for execution
   * threads, demos, and the web app.
   */
  transcriptUnreadDivider?: import('@shared/chatview').UnreadDividerDescriptor | undefined;
  /** Current user profile info, shown in GlobalRail avatar and profile popover. */
  userDisplayName?: string | undefined;
  userAvatarUrl?: string | undefined;
  /** Current user's Hub ID, used to distinguish "my" messages/tasks from others. */
  currentUserId?: string | undefined;
  /** Public Skill market items from Hub API. */
  skillMarketItems?: SkillMarketItem[] | undefined;
  /** Whether Skill market data is loading. */
  skillMarketLoading?: boolean | undefined;
  /**
   * Skill market load error (#1821). Shown as the market's error empty state;
   * absent when the query succeeded or never ran.
   */
  skillMarketError?: string | undefined;
  /** Public MCP Server market items from Hub API. */
  mcpMarketItems?: MCPMarketItem[] | undefined;
  /** Whether MCP Server market data is loading. */
  mcpMarketLoading?: boolean | undefined;
  /** MCP market load error (#1821); same contract as `skillMarketError`. */
  mcpMarketError?: string | undefined;
  /** Block ID to highlight (e.g. from a search result click). Cleared after 3 s animation. */
  highlightedBlockId?: string | undefined;
  /** Called when the highlight animation ends. */
  onHighlightEnd?: (() => void) | undefined;
  /**
   * Called when the user requests regeneration of an agent message. Receives
   * the block ID. May return a Promise: the chrome awaits it so a failed
   * regenerate surfaces an error toast instead of a fake success (#1821).
   */
  onRegenerate?: ((blockId: string) => Promise<void> | void) | undefined;
  /**
   * F1/F6 attention source: the shell's existing run/approval/thread model
   * arrays. The workbench derives sidebar live dots, the rail badge and the
   * status-strip counts from this single input (workbenchAttentionModel).
   * Absent on surfaces without a run inventory — all attention chrome hides.
   */
  attention?: WorkbenchAttentionInput | undefined;
  /** Whether an agent run is currently active (stop button morph, #1462 CF13). */
  isAgentRunning?: boolean | undefined;
  /** Cancel the active agent run (stop button handler). */
  onCancelRun?: (() => void) | undefined;
  /** Edit an already-sent message (#1462 CF16). Receives block id + new content. */
  onEditMessage?: ((blockId: string, content: string) => Promise<void> | void) | undefined;
  /**
   * Hub REST message actions (#1383). `activeConversationId` is reused as the
   * session id. All handlers receive the raw block id (`hub-message-<uuid>`);
   * parents strip the prefix before calling the Hub API.
   *
   * Optional per action — and since #2154 the transcript context menu is
   * fail-closed per action too: `workbenchTranscriptChromeHelpers`
   * `.contextMenuGroups` derives one capability per entry, so an omitted port
   * hides exactly that entry instead of rendering a click the effect
   * dispatcher would drop. The gates are: pin/unpin/recall need a session id
   * *and* their handler (the planner cannot build the effect without a session
   * id, #1818); forward needs its handler *and* a conversation list (the
   * picker submenu is the only real forward path, #1385); regenerate needs its
   * handler.
   *
   * Desktop is therefore NOT a shell that omits them: it sets
   * `activeConversationId` and wires pin/unpin/recall (#2154) plus forward
   * (#2241). Only demo shells — and any shell whose Hub chat actions are not
   * ready — leave these ports undefined today. `onAddMessageReaction` has no
   * transcript-menu entry at all right now: the react submenu was removed as
   * write-only (#1822), so no capability gates on it.
   *
   * Returned Promises are awaited by the chrome so failures surface a toast
   * (#1821).
   */
  onPinMessage?: ((messageId: string, sessionId: string) => Promise<void> | void) | undefined;
  onUnpinMessage?: ((messageId: string, sessionId: string) => Promise<void> | void) | undefined;
  onForwardMessage?: ((messageId: string, targetSessionIds: string[]) => Promise<void> | void) | undefined;
  onRecallMessage?: ((messageId: string) => Promise<void> | void) | undefined;
  onAddMessageReaction?: ((messageId: string, sessionId: string, emoji: string) => Promise<void> | void) | undefined;
  /** WebSocket connection status for the rail indicator dot. */
  connectionStatus?: ConnectionStatusKind | undefined;
  /**
   * Transcript items are loading (session switch / first load, #1821). When
   * the transcript is empty, the chat shows an honest loading state instead
   * of the misleading "no messages" empty state.
   */
  transcriptLoading?: boolean | undefined;
  /* ── Devices / execution-target management page (#1819) ──
     Real data from the Hub execution-target inventory + ping mutation.
     `devicesTargets === undefined` means the shell is not Hub-connected and
     the page renders sign-in guidance instead of an empty list. */
  devicesTargets?: import('./pages/DevicesPage').DevicesPageTarget[] | undefined;
  devicesLoading?: boolean | undefined;
  devicesError?: string | null | undefined;
  onDevicesRetry?: (() => void) | undefined;
  /** Execution-target id currently being pinged (busy row state). */
  devicesPingingId?: string | null | undefined;
  onDevicePing?: ((targetId: string) => void) | undefined;
  /* ── Token / cost usage board (#1819) ──
     Shell composes each team's runs (token_usage_total from migration 0066).
     `usageTeams === undefined` means the shell is not Hub-connected. */
  usageTeams?: import('./pages/TokenUsagePage').TokenUsagePageTeam[] | undefined;
  usageLoading?: boolean | undefined;
  usageError?: string | null | undefined;
  onUsageRetry?: (() => void) | undefined;
}
