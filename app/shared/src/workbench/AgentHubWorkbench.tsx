import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AgentHubPlatform,
  WorkbenchAgent,
  WorkbenchConversation,
} from '../platform';
import type { TranscriptBlock, ApprovalDecisionAction } from '../transcript';
import { type GlobalRailPage, type ConnectionStatusKind } from './GlobalRail';
import type { RuntimeEvidenceSnapshot } from './RightInspector';
import type { WorkbenchAgentProfilesStatus, WorkbenchContactsData, WorkbenchContactsActions, WorkbenchDocumentsActions } from './WorkbenchRoutes';
import type { HubClient } from '../hubClient';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';

import type { AgentConfig, ProjectDraft, DocRow } from './pages';
import type { SkillMarketItem, MCPMarketItem } from './pages/AgentsPage';
import type { ProjectInfo } from './pages/ProjectsPage';
import { useWorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import { useWorkbenchProfileChrome } from './useWorkbenchProfileChrome';
import { useWorkbenchSessionChrome } from './useWorkbenchSessionChrome';
import { useWorkbenchTranscriptChrome } from './useWorkbenchTranscriptChrome';
import { WorkbenchFrame } from './WorkbenchFrame';
import { WorkbenchProfileOverlays } from './WorkbenchProfileOverlays';
import { WorkbenchTranscriptOverlays } from './WorkbenchTranscriptOverlays';

export interface AgentHubWorkbenchProps {
  platform: AgentHubPlatform;
  conversations: WorkbenchConversation[];
  agents?: WorkbenchAgent[];
  composerExecutionTargets?: Array<{ id: string; label: string }> | undefined;
  workbenchStatus?: {
    dataMode?: string;
    replayLabel?: string;
    targetLabel?: string;
    targetState?: string;
    /** Whether the workbench is loading initial data (threads/conversations not yet loaded). */
    initialLoading?: boolean;
    /** Error message from initial data load, if any. */
    loadError?: string;
  } | undefined;
  agentProfilesStatus?: WorkbenchAgentProfilesStatus | undefined;
  contacts?: WorkbenchContactsData | undefined;
  projects?: ProjectInfo[] | undefined;
  activeProjectId?: string | undefined;
  projectsStatus?: {
    loading?: boolean | undefined;
    error?: string | undefined;
    actionError?: string | undefined;
    saving?: boolean | undefined;
  } | undefined;
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
  /** Hub client for direct project API access when onProjectCreate/Update are not provided. */
  hubClient?: HubClient | undefined;
  onApprovalDecision?: ((action: ApprovalDecisionAction) => Promise<void> | void) | undefined;
  /** 用户想与某个联系人/Agent 开始私聊，但当前没有已有会话时触发。上层负责创建会话并切换。 */
  onNavigateToConversation?: ((target: { name: string; id: string; kind: 'dm' | 'group' }) => void) | undefined;
  /** Contact mutation actions passed through to ContactsPage. */
  contactsActions?: WorkbenchContactsActions | undefined;
  /** Document rows for DocsPage (real data first, mock fallback). */
  documents?: DocRow[] | undefined;
  /** Document mutation actions wired to Hub Documents API. */
  documentsActions?: WorkbenchDocumentsActions | undefined;
  /** Model catalog items from Edge API. When provided, the Agents page
   *  Models tab shows real model data instead of mock fixtures. */
  modelCatalog?: Array<{
    id: string;
    label: string;
    value: string;
    provider?: string;
    status: string;
    description?: string;
    default?: boolean;
    tags?: string[];
  }> | undefined;
  /** cc-switch transparent proxy status from Edge API. */
  ccSwitchStatus?: import('./pages/AgentsPage').CCSwitchStatusInfo | undefined;
  /** cc-switch provider model alias mappings. */
  ccSwitchProviders?: import('./pages/AgentsPage').CCSwitchProviderInfo[] | undefined;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  showComposerAgentPicker?: boolean | undefined;
  showComposerStatus?: boolean | undefined;
  showMainchainStatus?: boolean | undefined;
  transcript: TranscriptBlock[];
  /** Current user profile info, shown in GlobalRail avatar and profile popover. */
  userDisplayName?: string | undefined;
  userAvatarUrl?: string | undefined;
  /** Current user's Hub ID, used to distinguish "my" messages/tasks from others. */
  currentUserId?: string | undefined;
  /** Public Skill market items from Hub API. */
  skillMarketItems?: SkillMarketItem[] | undefined;
  /** Whether Skill market data is loading. */
  skillMarketLoading?: boolean | undefined;
  /** Public MCP Server market items from Hub API. */
  mcpMarketItems?: MCPMarketItem[] | undefined;
  /** Whether MCP Server market data is loading. */
  mcpMarketLoading?: boolean | undefined;
  /** Block ID to highlight (e.g. from a search result click). Cleared after 3 s animation. */
  highlightedBlockId?: string | undefined;
  /** Called when the highlight animation ends. */
  onHighlightEnd?: (() => void) | undefined;
  /** Called when the user requests regeneration of an agent message. Receives the block ID. */
  onRegenerate?: ((blockId: string) => void) | undefined;
  /** WebSocket connection status for the rail indicator dot. */
  connectionStatus?: ConnectionStatusKind | undefined;
}

export function AgentHubWorkbench({
  platform,
  conversations,
  agents,
  composerExecutionTargets,
  workbenchStatus,
  agentProfilesStatus,
  contacts,
  projects,
  activeProjectId,
  projectsStatus,
  activeConversationId,
  onActiveConversationChange,
  onConversationPin,
  onConversationArchive,
  onActiveProjectChange,
  onAgentCreate,
  onAgentUpdate,
  onAgentDelete,
  onAgentsRetry,
  onLogout,
  onProjectCreate,
  onProjectUpdate,
  hubClient,
  onApprovalDecision,
  onNavigateToConversation,
  contactsActions,
  documents,
  documentsActions,
  modelCatalog,
  ccSwitchStatus,
  ccSwitchProviders,
  runtimeEvidence,
  showComposerAgentPicker = true,
  showComposerStatus = true,
  showMainchainStatus = true,
  transcript,
  userDisplayName,
  userAvatarUrl,
  currentUserId,
  skillMarketItems,
  skillMarketLoading,
  mcpMarketItems,
  mcpMarketLoading,
  highlightedBlockId,
  onHighlightEnd,
  onRegenerate,
  connectionStatus,
}: AgentHubWorkbenchProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const translate = t as (key: string, options?: Record<string, unknown>) => string;

  const [activePage, setActivePage] = useState<GlobalRailPage>('chat');
  const isChatPage = activePage === 'chat';
  const layout = useWorkbenchPanelLayout({
    activePage,
    isChatPage,
    platformSurface: platform.surface,
    setActivePage,
  });

  // Session owns composer/workspace refs and may run before transcript chrome is composed.
  // Bridge transcript helpers through a ref so user-driven handlers always see the latest impl.
  const transcriptHelpersRef = useRef({
    showWorkbenchToast: (_message: string) => {},
    copyText: (_text: string) => {},
    resetSelection: () => {},
  });

  const session = useWorkbenchSessionChrome({
    platform,
    conversations,
    activeConversationId,
    onActiveConversationChange,
    agents,
    composerExecutionTargets,
    transcript,
    runtimeEvidence,
    workbenchStatus,
    activePage,
    isChatPage,
    openInspector: layout.openInspector,
    showWorkbenchToast: (message) => transcriptHelpersRef.current.showWorkbenchToast(message),
    copyText: (text) => transcriptHelpersRef.current.copyText(text),
    resetSelection: () => transcriptHelpersRef.current.resetSelection(),
    t: translate,
  });

  const transcriptChrome = useWorkbenchTranscriptChrome({
    transcript,
    t: translate,
    onApprovalDecision,
    onRegenerate,
    dispatchComposer: session.dispatchComposer,
    composerInputRef: session.composerInputRef,
    workspaceRef: session.workspaceRef,
    inspectorCollapsed: layout.inspectorCollapsed,
    inspectorWidth: layout.inspectorWidth,
  });

  transcriptHelpersRef.current = {
    showWorkbenchToast: transcriptChrome.showWorkbenchToast,
    copyText: transcriptChrome.copyText,
    resetSelection: transcriptChrome.resetSelection,
  };

  const profile = useWorkbenchProfileChrome({
    agents,
    conversations,
    t: translate,
    selectConversation: session.selectConversation,
    setActivePage,
    showWorkbenchToast: transcriptChrome.showWorkbenchToast,
    copyText: transcriptChrome.copyText,
    composerInputRef: session.composerInputRef,
    onNavigateToConversation,
  });

  return (
    <WorkbenchFrame
      platform={platform}
      activePage={activePage}
      isChatPage={isChatPage}
      layout={layout}
      session={session}
      transcriptChrome={transcriptChrome}
      profile={profile}
      conversations={conversations}
      agents={agents}
      composerExecutionTargets={composerExecutionTargets}
      workbenchStatus={workbenchStatus}
      agentProfilesStatus={agentProfilesStatus}
      contacts={contacts}
      projects={projects}
      activeProjectId={activeProjectId}
      projectsStatus={projectsStatus}
      onConversationPin={onConversationPin}
      onConversationArchive={onConversationArchive}
      onActiveProjectChange={onActiveProjectChange}
      onAgentCreate={onAgentCreate}
      onAgentUpdate={onAgentUpdate}
      onAgentDelete={onAgentDelete}
      onAgentsRetry={onAgentsRetry}
      onLogout={onLogout}
      onProjectCreate={onProjectCreate}
      onProjectUpdate={onProjectUpdate}
      hubClient={hubClient}
      onNavigateToConversation={onNavigateToConversation}
      contactsActions={contactsActions}
      documents={documents}
      documentsActions={documentsActions}
      modelCatalog={modelCatalog}
      ccSwitchStatus={ccSwitchStatus}
      ccSwitchProviders={ccSwitchProviders}
      runtimeEvidence={runtimeEvidence}
      showComposerAgentPicker={showComposerAgentPicker}
      showComposerStatus={showComposerStatus}
      showMainchainStatus={showMainchainStatus}
      transcript={transcript}
      userDisplayName={userDisplayName}
      userAvatarUrl={userAvatarUrl}
      currentUserId={currentUserId}
      skillMarketItems={skillMarketItems}
      skillMarketLoading={skillMarketLoading}
      mcpMarketItems={mcpMarketItems}
      mcpMarketLoading={mcpMarketLoading}
      highlightedBlockId={highlightedBlockId}
      onHighlightEnd={onHighlightEnd}
      connectionStatus={connectionStatus}
      setActivePage={setActivePage}
    >
      <WorkbenchTranscriptOverlays
        isChatPage={isChatPage}
        contextMenu={transcriptChrome.contextMenu}
        contextMenuGroups={transcriptChrome.contextMenuGroups}
        onCloseContextMenu={() => transcriptChrome.setContextMenu(null)}
        selectionMode={transcriptChrome.selectionMode}
        multiSelectActions={transcriptChrome.multiSelectActions}
        selectedCount={transcriptChrome.selectedBlockIds.length}
        totalCount={transcript.length}
        selectBarRect={transcriptChrome.selectBarRect}
        toastMessage={transcriptChrome.toastMessage}
        toastVisible={transcriptChrome.toastVisible}
      />
      <WorkbenchProfileOverlays
        t={translate}
        activeAgentProfile={profile.activeAgentProfile}
        activeHumanProfile={profile.activeHumanProfile}
        activeGroupProfile={profile.activeGroupProfile}
        onCloseAgentProfile={() => profile.setActiveAgentProfile(null)}
        onCloseHumanProfile={() => profile.setActiveHumanProfile(null)}
        onCloseGroupProfile={() => profile.setActiveGroupProfile(null)}
        onAgentDirectMessage={profile.openAgentDirectMessage}
        onAgentConfig={profile.openAgentConfig}
        onHumanDirectMessage={profile.openHumanDirectMessage}
        onCopyHumanProfileLink={profile.copyHumanProfileLink}
        onGroupSendMessage={profile.openGroupConversation}
      />
    </WorkbenchFrame>
  );
}
