import type { Dispatch, SetStateAction } from 'react';
import type { WorkbenchConversation } from '@shared/platform';
import type { GlobalRailPage } from './GlobalRail';
import type { WorkbenchFrameProps } from './workbenchFrameTypes';
import type { UseWorkbenchSessionChromeOptions, WorkbenchSessionChrome } from './workbenchSessionChromeHelpers';
import type {
  UseWorkbenchTranscriptChromeOptions,
  WorkbenchTranscriptChrome,
} from './useWorkbenchTranscriptChrome';
import type {
  UseWorkbenchProfileChromeOptions,
  WorkbenchProfileChrome,
} from './useWorkbenchProfileChrome';
import type { WorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import type { WorkbenchTranscriptOverlaysProps } from './WorkbenchTranscriptOverlays';
import type { WorkbenchProfileOverlaysProps } from './WorkbenchProfileOverlays';
import type { AgentHubWorkbenchProps } from './AgentHubWorkbenchTypes';

/* ═══════════════════════════════════════════════════════════════════════
   AgentHubWorkbenchHelpers — pure residual slices from AgentHubWorkbench
   (#683). Chrome option builders + frame/overlay prop planners.
   No React hooks / no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined.
   ═══════════════════════════════════════════════════════════════════════ */

export type WorkbenchTranslate = (key: string, options?: Record<string, unknown>) => string;

export interface TranscriptHelpersBridge {
  showWorkbenchToast: (message: string) => void;
  copyText: (text: string) => void;
  resetSelection: () => void;
}

/** Assign optional prop only when value is defined (exactOptionalPropertyTypes). */
export function assignDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

export function createEmptyTranscriptHelpersBridge(): TranscriptHelpersBridge {
  return {
    showWorkbenchToast: (_message: string) => {},
    copyText: (_text: string) => {},
    resetSelection: () => {},
  };
}

export function resolveWorkbenchComposerFlags(props: Pick<
  AgentHubWorkbenchProps,
  'showComposerAgentPicker' | 'showComposerStatus' | 'showMainchainStatus'
>): {
  showComposerAgentPicker: boolean;
  showComposerStatus: boolean;
  showMainchainStatus: boolean;
} {
  return {
    showComposerAgentPicker: props.showComposerAgentPicker ?? true,
    showComposerStatus: props.showComposerStatus ?? true,
    showMainchainStatus: props.showMainchainStatus ?? true,
  };
}

export function isWorkbenchChatPage(activePage: GlobalRailPage): boolean {
  return activePage === 'chat';
}

export interface BuildSessionChromeOptionsInput {
  props: Pick<
    AgentHubWorkbenchProps,
    | 'platform'
    | 'conversations'
    | 'activeConversationId'
    | 'onActiveConversationChange'
    | 'agents'
    | 'composerExecutionTargets'
    | 'transcript'
    | 'runtimeEvidence'
    | 'workbenchStatus'
  >;
  activePage: GlobalRailPage;
  isChatPage: boolean;
  openInspector: () => void;
  transcriptHelpersRef: { current: TranscriptHelpersBridge };
  t: WorkbenchTranslate;
}

export function buildSessionChromeOptions(
  input: BuildSessionChromeOptionsInput,
): UseWorkbenchSessionChromeOptions {
  const { props, activePage, isChatPage, openInspector, transcriptHelpersRef, t } = input;
  const options: UseWorkbenchSessionChromeOptions = {
    platform: props.platform,
    conversations: props.conversations,
    transcript: props.transcript,
    activePage,
    isChatPage,
    openInspector,
    showWorkbenchToast: (message) => transcriptHelpersRef.current.showWorkbenchToast(message),
    copyText: (text) => transcriptHelpersRef.current.copyText(text),
    resetSelection: () => transcriptHelpersRef.current.resetSelection(),
    t,
  };

  assignDefined(options, 'activeConversationId', props.activeConversationId);
  assignDefined(options, 'onActiveConversationChange', props.onActiveConversationChange);
  assignDefined(options, 'agents', props.agents);
  assignDefined(options, 'composerExecutionTargets', props.composerExecutionTargets);
  assignDefined(options, 'runtimeEvidence', props.runtimeEvidence);
  assignDefined(options, 'workbenchStatus', props.workbenchStatus);

  return options;
}

export interface BuildTranscriptChromeOptionsInput {
  props: Pick<
    AgentHubWorkbenchProps,
    | 'transcript'
    | 'onApprovalDecision'
    | 'onRegenerate'
    | 'activeConversationId'
    | 'onPinMessage'
    | 'onUnpinMessage'
    | 'onForwardMessage'
    | 'onRecallMessage'
    | 'onAddMessageReaction'
  >;
  t: WorkbenchTranslate;
  session: Pick<
    WorkbenchSessionChrome,
    'dispatchComposer' | 'composerInputRef' | 'workspaceRef'
  >;
  layout: Pick<WorkbenchPanelLayout, 'inspectorCollapsed' | 'inspectorWidth'>;
}

export function buildTranscriptChromeOptions(
  input: BuildTranscriptChromeOptionsInput,
): UseWorkbenchTranscriptChromeOptions {
  const { props, t, session, layout } = input;
  const options: UseWorkbenchTranscriptChromeOptions = {
    transcript: props.transcript,
    t,
    dispatchComposer: session.dispatchComposer,
    composerInputRef: session.composerInputRef,
    workspaceRef: session.workspaceRef,
    inspectorCollapsed: layout.inspectorCollapsed,
    inspectorWidth: layout.inspectorWidth,
  };

  assignDefined(options, 'onApprovalDecision', props.onApprovalDecision);
  assignDefined(options, 'onRegenerate', props.onRegenerate);
  // #1383 REST message actions: activeConversationId doubles as the session id.
  assignDefined(options, 'sessionId', props.activeConversationId);
  assignDefined(options, 'onPinMessage', props.onPinMessage);
  assignDefined(options, 'onUnpinMessage', props.onUnpinMessage);
  assignDefined(options, 'onForwardMessage', props.onForwardMessage);
  assignDefined(options, 'onRecallMessage', props.onRecallMessage);
  assignDefined(options, 'onAddMessageReaction', props.onAddMessageReaction);

  return options;
}

export interface BuildProfileChromeOptionsInput {
  props: Pick<AgentHubWorkbenchProps, 'agents' | 'conversations' | 'onNavigateToConversation'>;
  t: WorkbenchTranslate;
  session: Pick<WorkbenchSessionChrome, 'selectConversation' | 'composerInputRef'>;
  setActivePage: Dispatch<SetStateAction<GlobalRailPage>>;
  showWorkbenchToast: (message: string) => void;
  copyText: (text: string) => void;
}

export function buildProfileChromeOptions(
  input: BuildProfileChromeOptionsInput,
): UseWorkbenchProfileChromeOptions {
  const { props, t, session, setActivePage, showWorkbenchToast, copyText } = input;
  const options: UseWorkbenchProfileChromeOptions = {
    conversations: props.conversations,
    t,
    selectConversation: session.selectConversation,
    setActivePage,
    showWorkbenchToast,
    copyText,
    composerInputRef: session.composerInputRef,
  };

  assignDefined(options, 'agents', props.agents);
  assignDefined(options, 'onNavigateToConversation', props.onNavigateToConversation);

  return options;
}

export interface BuildWorkbenchFramePropsInput {
  props: AgentHubWorkbenchProps;
  activePage: GlobalRailPage;
  isChatPage: boolean;
  layout: WorkbenchPanelLayout;
  session: WorkbenchSessionChrome;
  transcriptChrome: WorkbenchTranscriptChrome;
  profile: WorkbenchProfileChrome;
  setActivePage: Dispatch<SetStateAction<GlobalRailPage>>;
  showComposerAgentPicker: boolean;
  showComposerStatus: boolean;
  showMainchainStatus: boolean;
  children: WorkbenchFrameProps['children'];
}

export function buildWorkbenchFrameProps(
  input: BuildWorkbenchFramePropsInput,
): WorkbenchFrameProps {
  const {
    props,
    activePage,
    isChatPage,
    layout,
    session,
    transcriptChrome,
    profile,
    setActivePage,
    showComposerAgentPicker,
    showComposerStatus,
    showMainchainStatus,
    children,
  } = input;

  const frameProps: WorkbenchFrameProps = {
    platform: props.platform,
    activePage,
    isChatPage,
    layout,
    session,
    transcriptChrome,
    profile,
    conversations: props.conversations,
    showComposerAgentPicker,
    showComposerStatus,
    showMainchainStatus,
    transcript: props.transcript,
    setActivePage,
  };

  assignDefined(frameProps, 'transcriptUnreadDivider', props.transcriptUnreadDivider);

  assignDefined(frameProps, 'agents', props.agents);
  assignDefined(frameProps, 'composerExecutionTargets', props.composerExecutionTargets);
  assignDefined(frameProps, 'workbenchStatus', props.workbenchStatus);
  assignDefined(frameProps, 'agentProfilesStatus', props.agentProfilesStatus);
  assignDefined(frameProps, 'contacts', props.contacts);
  assignDefined(frameProps, 'projects', props.projects);
  assignDefined(frameProps, 'activeProjectId', props.activeProjectId);
  assignDefined(frameProps, 'projectsStatus', props.projectsStatus);
  assignDefined(frameProps, 'onConversationPin', props.onConversationPin);
  assignDefined(frameProps, 'onConversationArchive', props.onConversationArchive);
  assignDefined(frameProps, 'onActiveProjectChange', props.onActiveProjectChange);
  assignDefined(frameProps, 'onAgentCreate', props.onAgentCreate);
  assignDefined(frameProps, 'onAgentUpdate', props.onAgentUpdate);
  assignDefined(frameProps, 'onAgentDelete', props.onAgentDelete);
  assignDefined(frameProps, 'onAgentsRetry', props.onAgentsRetry);
  assignDefined(frameProps, 'onLogout', props.onLogout);
  assignDefined(frameProps, 'onProjectCreate', props.onProjectCreate);
  assignDefined(frameProps, 'onProjectUpdate', props.onProjectUpdate);
  assignDefined(frameProps, 'projectsPort', props.projectsPort);
  assignDefined(frameProps, 'onNavigateToConversation', props.onNavigateToConversation);
  assignDefined(frameProps, 'contactsActions', props.contactsActions);
  assignDefined(frameProps, 'documents', props.documents);
  assignDefined(frameProps, 'documentsActions', props.documentsActions);
  assignDefined(frameProps, 'modelCatalog', props.modelCatalog);
  assignDefined(frameProps, 'ccSwitchStatus', props.ccSwitchStatus);
  assignDefined(frameProps, 'ccSwitchProviders', props.ccSwitchProviders);
  assignDefined(frameProps, 'runtimeEvidence', props.runtimeEvidence);
  assignDefined(frameProps, 'userDisplayName', props.userDisplayName);
  assignDefined(frameProps, 'userAvatarUrl', props.userAvatarUrl);
  assignDefined(frameProps, 'currentUserId', props.currentUserId);
  assignDefined(frameProps, 'skillMarketItems', props.skillMarketItems);
  assignDefined(frameProps, 'skillMarketLoading', props.skillMarketLoading);
  assignDefined(frameProps, 'skillMarketError', props.skillMarketError);
  assignDefined(frameProps, 'mcpMarketItems', props.mcpMarketItems);
  assignDefined(frameProps, 'mcpMarketLoading', props.mcpMarketLoading);
  assignDefined(frameProps, 'mcpMarketError', props.mcpMarketError);
  assignDefined(frameProps, 'highlightedBlockId', props.highlightedBlockId);
  assignDefined(frameProps, 'onHighlightEnd', props.onHighlightEnd);
  assignDefined(frameProps, 'connectionStatus', props.connectionStatus);
  assignDefined(frameProps, 'isAgentRunning', props.isAgentRunning);
  assignDefined(frameProps, 'onCancelRun', props.onCancelRun);
  assignDefined(frameProps, 'onEditMessage', props.onEditMessage);
  assignDefined(frameProps, 'transcriptLoading', props.transcriptLoading);
  assignDefined(frameProps, 'devicesTargets', props.devicesTargets);
  assignDefined(frameProps, 'devicesLoading', props.devicesLoading);
  assignDefined(frameProps, 'devicesError', props.devicesError);
  assignDefined(frameProps, 'onDevicesRetry', props.onDevicesRetry);
  assignDefined(frameProps, 'devicesPingingId', props.devicesPingingId);
  assignDefined(frameProps, 'onDevicePing', props.onDevicePing);
  assignDefined(frameProps, 'usageTeams', props.usageTeams);
  assignDefined(frameProps, 'usageLoading', props.usageLoading);
  assignDefined(frameProps, 'usageError', props.usageError);
  assignDefined(frameProps, 'onUsageRetry', props.onUsageRetry);
  assignDefined(frameProps, 'children', children);

  return frameProps;
}

export function buildTranscriptOverlaysProps(input: {
  isChatPage: boolean;
  transcriptChrome: WorkbenchTranscriptChrome;
  transcriptLength: number;
  /** Forward target candidates (#1385) — forwarded to the context menu builder. */
  conversations?: WorkbenchConversation[] | undefined;
}): WorkbenchTranscriptOverlaysProps {
  const { isChatPage, transcriptChrome, transcriptLength, conversations } = input;
  return {
    isChatPage,
    contextMenu: transcriptChrome.contextMenu,
    contextMenuGroups: transcriptChrome.contextMenuGroups,
    ...(conversations !== undefined ? { conversations } : {}),
    onCloseContextMenu: () => transcriptChrome.setContextMenu(null),
    selectionMode: transcriptChrome.selectionMode,
    multiSelectActions: transcriptChrome.multiSelectActions,
    selectedCount: transcriptChrome.selectedBlockIds.length,
    totalCount: transcriptLength,
    selectBarRect: transcriptChrome.selectBarRect,
    toastMessage: transcriptChrome.toastMessage,
    toastVisible: transcriptChrome.toastVisible,
  };
}

export function buildProfileOverlaysProps(input: {
  t: WorkbenchTranslate;
  profile: WorkbenchProfileChrome;
}): WorkbenchProfileOverlaysProps {
  const { t, profile } = input;
  return {
    t,
    activeAgentProfile: profile.activeAgentProfile,
    activeHumanProfile: profile.activeHumanProfile,
    activeGroupProfile: profile.activeGroupProfile,
    onCloseAgentProfile: () => profile.setActiveAgentProfile(null),
    onCloseHumanProfile: () => profile.setActiveHumanProfile(null),
    onCloseGroupProfile: () => profile.setActiveGroupProfile(null),
    onAgentDirectMessage: profile.openAgentDirectMessage,
    onAgentConfig: profile.openAgentConfig,
    onHumanDirectMessage: profile.openHumanDirectMessage,
    onCopyHumanProfileLink: profile.copyHumanProfileLink,
    onGroupSendMessage: profile.openGroupConversation,
  };
}
