import { describe, expect, it, vi } from 'vitest';
import type { AgentHubPlatform, WorkbenchConversation } from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript';
import type { GlobalRailPage } from './GlobalRail';
import type { WorkbenchSessionChrome } from './workbenchSessionChromeHelpers';
import type { WorkbenchTranscriptChrome } from './useWorkbenchTranscriptChrome';
import type { WorkbenchProfileChrome } from './useWorkbenchProfileChrome';
import type { WorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import type { AgentHubWorkbenchProps } from './AgentHubWorkbenchTypes';
import {
  assignDefined,
  buildProfileChromeOptions,
  buildProfileOverlaysProps,
  buildSessionChromeOptions,
  buildTranscriptChromeOptions,
  buildTranscriptOverlaysProps,
  buildWorkbenchFrameProps,
  createEmptyTranscriptHelpersBridge,
  isWorkbenchChatPage,
  resolveWorkbenchComposerFlags,
} from './AgentHubWorkbenchHelpers';

function platformStub(): AgentHubPlatform {
  return {
    surface: 'web',
    capabilities: { browserPreview: true },
    seed: { conversations: [] },
  } as unknown as AgentHubPlatform;
}

function conversation(id = 'c1'): WorkbenchConversation {
  return {
    id,
    title: 'Builder',
    kind: 'direct',
  };
}

function textBlock(id = 'b1'): TranscriptBlock {
  return {
    id,
    kind: 'text',
    author: { id: 'user', name: 'User', role: 'human' },
    text: 'hello',
  };
}

function baseProps(overrides: Partial<AgentHubWorkbenchProps> = {}): AgentHubWorkbenchProps {
  return {
    platform: platformStub(),
    conversations: [conversation()],
    transcript: [textBlock()],
    ...overrides,
  };
}

describe('AgentHubWorkbenchHelpers', () => {
  it('assigns optional fields only when defined', () => {
    const target: { a?: string; b?: number } = {};
    assignDefined(target, 'a', undefined);
    expect('a' in target).toBe(false);
    assignDefined(target, 'a', 'x');
    assignDefined(target, 'b', 2);
    expect(target).toEqual({ a: 'x', b: 2 });
  });

  it('creates a no-op transcript helpers bridge', () => {
    const bridge = createEmptyTranscriptHelpersBridge();
    expect(() => bridge.showWorkbenchToast('toast')).not.toThrow();
    expect(() => bridge.copyText('copy')).not.toThrow();
    expect(() => bridge.resetSelection()).not.toThrow();
  });

  it('resolves composer feature flags with defaults', () => {
    expect(resolveWorkbenchComposerFlags({})).toEqual({
      showComposerAgentPicker: true,
      showComposerStatus: true,
      showMainchainStatus: true,
    });
    expect(resolveWorkbenchComposerFlags({
      showComposerAgentPicker: false,
      showComposerStatus: false,
      showMainchainStatus: false,
    })).toEqual({
      showComposerAgentPicker: false,
      showComposerStatus: false,
      showMainchainStatus: false,
    });
  });

  it('detects chat page', () => {
    expect(isWorkbenchChatPage('chat')).toBe(true);
    expect(isWorkbenchChatPage('agents')).toBe(false);
  });

  it('builds session chrome options with exactOptionalPropertyTypes-safe optionals', () => {
    const openInspector = vi.fn();
    const transcriptHelpersRef = { current: createEmptyTranscriptHelpersBridge() };
    const t = vi.fn((key: string) => key);
    const onActiveConversationChange = vi.fn();

    const withoutOptionals = buildSessionChromeOptions({
      props: baseProps(),
      activePage: 'chat',
      isChatPage: true,
      openInspector,
      transcriptHelpersRef,
      t,
    });
    expect(withoutOptionals.platform.surface).toBe('web');
    expect(withoutOptionals.conversations).toHaveLength(1);
    expect(withoutOptionals.activePage).toBe('chat');
    expect(withoutOptionals.isChatPage).toBe(true);
    expect(withoutOptionals.openInspector).toBe(openInspector);
    expect('agents' in withoutOptionals).toBe(false);
    expect('activeConversationId' in withoutOptionals).toBe(false);
    expect('onActiveConversationChange' in withoutOptionals).toBe(false);
    expect('composerExecutionTargets' in withoutOptionals).toBe(false);
    expect('runtimeEvidence' in withoutOptionals).toBe(false);
    expect('workbenchStatus' in withoutOptionals).toBe(false);

    transcriptHelpersRef.current.showWorkbenchToast = vi.fn();
    withoutOptionals.showWorkbenchToast('hello');
    expect(transcriptHelpersRef.current.showWorkbenchToast).toHaveBeenCalledWith('hello');

    const withOptionals = buildSessionChromeOptions({
      props: baseProps({
        agents: [{ id: 'a1', name: 'A', description: '', status: 'available' }],
        activeConversationId: 'c1',
        onActiveConversationChange,
        composerExecutionTargets: [{ id: 't1', label: 'Target' }],
        runtimeEvidence: {
          runId: 'run-1',
          diffs: [],
          artifacts: [],
          previews: [],
          sources: { diff: 'none', artifacts: 'none', previews: 'none' },
        },
        workbenchStatus: { dataMode: 'approved-real', initialLoading: true },
      }),
      activePage: 'agents' as GlobalRailPage,
      isChatPage: false,
      openInspector,
      transcriptHelpersRef,
      t,
    });
    expect(withOptionals.agents?.[0]?.id).toBe('a1');
    expect(withOptionals.activeConversationId).toBe('c1');
    expect(withOptionals.onActiveConversationChange).toBe(onActiveConversationChange);
    expect(withOptionals.composerExecutionTargets).toEqual([{ id: 't1', label: 'Target' }]);
    expect(withOptionals.runtimeEvidence?.runId).toBe('run-1');
    expect(withOptionals.workbenchStatus?.dataMode).toBe('approved-real');
  });

  it('builds transcript chrome options with exactOptionalPropertyTypes-safe optionals', () => {
    const t = vi.fn((key: string) => key);
    const dispatchComposer = vi.fn();
    const composerInputRef = { current: null };
    const workspaceRef = { current: null };
    const onApprovalDecision = vi.fn();
    const onRegenerate = vi.fn();

    const withoutOptionals = buildTranscriptChromeOptions({
      props: baseProps(),
      t,
      session: {
        dispatchComposer,
        composerInputRef,
        workspaceRef,
      } as Pick<WorkbenchSessionChrome, 'dispatchComposer' | 'composerInputRef' | 'workspaceRef'>,
      layout: {
        inspectorCollapsed: false,
        inspectorWidth: 400,
      },
    });
    expect(withoutOptionals.transcript).toHaveLength(1);
    expect(withoutOptionals.dispatchComposer).toBe(dispatchComposer);
    expect(withoutOptionals.inspectorWidth).toBe(400);
    expect('onApprovalDecision' in withoutOptionals).toBe(false);
    expect('onRegenerate' in withoutOptionals).toBe(false);

    const withOptionals = buildTranscriptChromeOptions({
      props: baseProps({ onApprovalDecision, onRegenerate }),
      t,
      session: {
        dispatchComposer,
        composerInputRef,
        workspaceRef,
      } as Pick<WorkbenchSessionChrome, 'dispatchComposer' | 'composerInputRef' | 'workspaceRef'>,
      layout: {
        inspectorCollapsed: true,
        inspectorWidth: 48,
      },
    });
    expect(withOptionals.onApprovalDecision).toBe(onApprovalDecision);
    expect(withOptionals.onRegenerate).toBe(onRegenerate);
    expect(withOptionals.inspectorCollapsed).toBe(true);
  });

  it('builds profile chrome options with exactOptionalPropertyTypes-safe optionals', () => {
    const t = vi.fn((key: string) => key);
    const selectConversation = vi.fn();
    const setActivePage = vi.fn();
    const showWorkbenchToast = vi.fn();
    const copyText = vi.fn();
    const composerInputRef = { current: null };
    const onNavigateToConversation = vi.fn();

    const withoutOptionals = buildProfileChromeOptions({
      props: baseProps(),
      t,
      session: {
        selectConversation,
        composerInputRef,
      } as Pick<WorkbenchSessionChrome, 'selectConversation' | 'composerInputRef'>,
      setActivePage,
      showWorkbenchToast,
      copyText,
    });
    expect(withoutOptionals.conversations).toHaveLength(1);
    expect(withoutOptionals.selectConversation).toBe(selectConversation);
    expect('agents' in withoutOptionals).toBe(false);
    expect('onNavigateToConversation' in withoutOptionals).toBe(false);

    const withOptionals = buildProfileChromeOptions({
      props: baseProps({
        agents: [{ id: 'a1', name: 'A', description: '', status: 'available' }],
        onNavigateToConversation,
      }),
      t,
      session: {
        selectConversation,
        composerInputRef,
      } as Pick<WorkbenchSessionChrome, 'selectConversation' | 'composerInputRef'>,
      setActivePage,
      showWorkbenchToast,
      copyText,
    });
    expect(withOptionals.agents?.[0]?.id).toBe('a1');
    expect(withOptionals.onNavigateToConversation).toBe(onNavigateToConversation);
  });

  it('builds frame props without undefined optional keys', () => {
    const layout = {
      inspectorCollapsed: false,
      inspectorWidth: 400,
    } as WorkbenchPanelLayout;
    const session = {
      selectConversation: vi.fn(),
    } as unknown as WorkbenchSessionChrome;
    const transcriptChrome = {
      selectionMode: false,
    } as unknown as WorkbenchTranscriptChrome;
    const profile = {
      focusedAgentId: undefined,
    } as unknown as WorkbenchProfileChrome;
    const setActivePage = vi.fn();

    const minimal = buildWorkbenchFrameProps({
      props: baseProps(),
      activePage: 'chat',
      isChatPage: true,
      layout,
      session,
      transcriptChrome,
      profile,
      setActivePage,
      showComposerAgentPicker: true,
      showComposerStatus: true,
      showMainchainStatus: true,
      children: null,
    });

    expect(minimal.platform.surface).toBe('web');
    expect(minimal.activePage).toBe('chat');
    expect(minimal.showComposerAgentPicker).toBe(true);
    expect(minimal.transcript).toHaveLength(1);
    expect('agents' in minimal).toBe(false);
    expect('contacts' in minimal).toBe(false);
    expect('projects' in minimal).toBe(false);
    expect('onAgentCreate' in minimal).toBe(false);
    expect('projectsPort' in minimal).toBe(false);
    expect('connectionStatus' in minimal).toBe(false);
    expect('attention' in minimal).toBe(false);
    // children may be null — only assign when defined; null is defined
    expect(minimal.children).toBeNull();

    const onAgentCreate = vi.fn();
    const full = buildWorkbenchFrameProps({
      props: baseProps({
        agents: [{ id: 'a1', name: 'A', description: '', status: 'available' }],
        workbenchStatus: { dataMode: 'approved-real' },
        agentProfilesStatus: { loading: false },
        contacts: { members: [], recentShortcuts: [], orgName: 'TD', orgInitials: 'TD' },
        projects: [],
        activeProjectId: 'p1',
        projectsStatus: { loading: false },
        onAgentCreate,
        userDisplayName: 'User',
        connectionStatus: 'connected',
        highlightedBlockId: 'b1',
        attention: { runs: [], approvals: [], threads: [] },
      }),
      activePage: 'agents',
      isChatPage: false,
      layout,
      session,
      transcriptChrome,
      profile,
      setActivePage,
      showComposerAgentPicker: false,
      showComposerStatus: false,
      showMainchainStatus: false,
      children: undefined,
    });
    expect(full.agents?.[0]?.id).toBe('a1');
    expect(full.workbenchStatus?.dataMode).toBe('approved-real');
    expect(full.onAgentCreate).toBe(onAgentCreate);
    expect(full.userDisplayName).toBe('User');
    expect(full.connectionStatus).toBe('connected');
    expect(full.highlightedBlockId).toBe('b1');
    expect(full.attention).toEqual({ runs: [], approvals: [], threads: [] });
    expect(full.showComposerAgentPicker).toBe(false);
    expect('children' in full).toBe(false);
  });

  it('builds transcript overlay props from chrome state', () => {
    const setContextMenu = vi.fn();
    const contextMenuGroups = vi.fn(() => []);
    const multiSelectActions = [{ id: 'copy', label: 'Copy', onClick: () => {} }];
    const transcriptChrome = {
      contextMenu: { blockId: 'b1', title: 'Card', x: 1, y: 2 },
      contextMenuGroups,
      setContextMenu,
      selectionMode: true,
      multiSelectActions,
      selectedBlockIds: ['b1', 'b2'],
      selectBarRect: { left: 10, width: 200 },
      toastMessage: 'copied',
      toastVisible: true,
    } as unknown as WorkbenchTranscriptChrome;

    const props = buildTranscriptOverlaysProps({
      isChatPage: true,
      transcriptChrome,
      transcriptLength: 5,
    });
    expect(props.isChatPage).toBe(true);
    expect(props.contextMenu).toEqual({ blockId: 'b1', title: 'Card', x: 1, y: 2 });
    expect(props.contextMenuGroups).toBe(contextMenuGroups);
    expect(props.selectionMode).toBe(true);
    expect(props.selectedCount).toBe(2);
    expect(props.totalCount).toBe(5);
    expect(props.selectBarRect).toEqual({ left: 10, width: 200 });
    expect(props.toastMessage).toBe('copied');
    expect(props.toastVisible).toBe(true);
    props.onCloseContextMenu();
    expect(setContextMenu).toHaveBeenCalledWith(null);
  });

  it('builds profile overlay props from chrome state', () => {
    const t = vi.fn((key: string) => key);
    const setActiveAgentProfile = vi.fn();
    const setActiveHumanProfile = vi.fn();
    const setActiveGroupProfile = vi.fn();
    const openAgentDirectMessage = vi.fn();
    const openAgentConfig = vi.fn();
    const openHumanDirectMessage = vi.fn();
    const copyHumanProfileLink = vi.fn();
    const openGroupConversation = vi.fn();
    const profile = {
      activeAgentProfile: { id: 'a1' },
      activeHumanProfile: null,
      activeGroupProfile: null,
      setActiveAgentProfile,
      setActiveHumanProfile,
      setActiveGroupProfile,
      openAgentDirectMessage,
      openAgentConfig,
      openHumanDirectMessage,
      copyHumanProfileLink,
      openGroupConversation,
    } as unknown as WorkbenchProfileChrome;

    const props = buildProfileOverlaysProps({ t, profile });
    expect(props.t).toBe(t);
    expect(props.activeAgentProfile).toEqual({ id: 'a1' });
    expect(props.activeHumanProfile).toBeNull();
    expect(props.onAgentDirectMessage).toBe(openAgentDirectMessage);
    expect(props.onAgentConfig).toBe(openAgentConfig);
    expect(props.onHumanDirectMessage).toBe(openHumanDirectMessage);
    expect(props.onCopyHumanProfileLink).toBe(copyHumanProfileLink);
    expect(props.onGroupSendMessage).toBe(openGroupConversation);
    props.onCloseAgentProfile();
    props.onCloseHumanProfile();
    props.onCloseGroupProfile();
    expect(setActiveAgentProfile).toHaveBeenCalledWith(null);
    expect(setActiveHumanProfile).toHaveBeenCalledWith(null);
    expect(setActiveGroupProfile).toHaveBeenCalledWith(null);
  });
});
