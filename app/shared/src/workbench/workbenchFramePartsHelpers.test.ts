import { describe, expect, it, vi } from 'vitest';
import {
  buildChatConversationHostProps,
  buildChatInspectorProps,
  buildConversationSidebarProps,
  buildWorkbenchRoutesProps,
} from './workbenchFramePartsHelpers';
import {
  DEFAULT_BROWSER_PREVIEW_URL,
} from './workbenchFrameHelpers';
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
} from './workbenchLayoutConstants';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchFramePartsHelpers unit tests (#742)

   Pure prop-builder coverage for frame residual slices. No React render.
   ═══════════════════════════════════════════════════════════════════════ */

function sessionMock(overrides: Record<string, unknown> = {}) {
  return {
    currentConversationId: 'conv-1',
    activeConversation: { id: 'conv-1', title: 'Test Chat' },
    selectedExecutionTargetId: 'agent-1',
    setSelectedExecutionTargetId: vi.fn(),
    dismissedPinnedIds: new Set<string>(['pin-1']),
    searchOpen: false,
    setSearchOpen: vi.fn(),
    composerInputRef: { current: null },
    composer: { workDir: ' /tmp/work ' },
    dispatchComposer: vi.fn(),
    mainchainSummary: { status: 'ready' },
    mentionableAgents: [{ id: 'a1', label: 'Agent One' }],
    openReviewFile: vi.fn(),
    handleDeploySubmit: vi.fn(),
    exportMainchainEvidence: vi.fn(),
    reviewFileRequest: { path: '/a.ts' },
    evidence: [{ id: 'e1' }],
    inspectorRouteBlocks: [{ id: 'r1' }],
    inspectorContextBlocks: [{ id: 'c1' }],
    inspectorDeployPreviewUrl: 'https://preview.example',
    inspectorRunResult: { status: 'ok' },
    ...overrides,
  };
}

function transcriptChromeMock(overrides: Record<string, unknown> = {}) {
  return {
    selectionMode: true,
    selectedBlockIds: ['b1', 'b2'],
    softHiddenBlockIds: ['h1'],
    actionedBlockIds: ['a1'],
    showWorkbenchToast: vi.fn(),
    openBlockContextMenu: vi.fn(),
    handleBlockSelect: vi.fn(),
    handleTranscriptBlockAction: vi.fn(),
    ...overrides,
  };
}

function profileMock() {
  return {
    openAgentProfile: vi.fn(),
  };
}

function platformMock(overrides: Record<string, unknown> = {}) {
  return {
    surface: 'web',
    capabilities: { browserPreview: true },
    preview: { canOpenEvidence: true, openEvidence: vi.fn() },
    ...overrides,
  };
}

describe('workbenchFramePartsHelpers', () => {
  describe('buildConversationSidebarProps', () => {
    it('maps frame ids and always-on handlers', () => {
      const onSelectConversation = vi.fn();
      const onAvatarClick = vi.fn();
      const props = buildConversationSidebarProps({
        conversations: [{ id: 'c1' } as any],
        currentConversationId: 'c1',
        onSelectConversation,
        onAvatarClick,
      });

      expect(props.activeConversationId).toBe('c1');
      expect(props.conversations).toHaveLength(1);
      expect(props.onSelectConversation).toBe(onSelectConversation);
      expect(props.onAvatarClick).toBe(onAvatarClick);
      expect('onPinConversation' in props).toBe(false);
      expect('onArchiveConversation' in props).toBe(false);
    });

    it('assigns optional pin/archive handlers only when defined', () => {
      const onConversationPin = vi.fn();
      const withPin = buildConversationSidebarProps({
        conversations: [],
        currentConversationId: 'c1',
        onSelectConversation: vi.fn(),
        onAvatarClick: vi.fn(),
        onConversationPin,
      });
      expect(withPin.onPinConversation).toBe(onConversationPin);
      expect('onArchiveConversation' in withPin).toBe(false);

      const withBoth = buildConversationSidebarProps({
        conversations: [],
        currentConversationId: 'c1',
        onSelectConversation: vi.fn(),
        onAvatarClick: vi.fn(),
        onConversationPin,
        onConversationArchive: vi.fn(),
      });
      expect(withBoth.onPinConversation).toBe(onConversationPin);
      expect(typeof withBoth.onArchiveConversation).toBe('function');
    });
  });

  describe('buildChatConversationHostProps', () => {
    it('wires required host props and converts id arrays to sets', () => {
      const session = sessionMock();
      const transcriptChrome = transcriptChromeMock();
      const profile = profileMock();
      const platform = platformMock();
      const transcript = [{ id: 't1' } as any];
      const toggleInspector = vi.fn();

      const props = buildChatConversationHostProps({
        platform: platform as any,
        session: session as any,
        transcriptChrome: transcriptChrome as any,
        profile: profile as any,
        transcript,
        inspectorCollapsed: true,
        toggleInspector,
        showMainchainStatus: true,
        showComposerAgentPicker: true,
        showComposerStatus: false,
      });

      expect(props.currentConversationId).toBe('conv-1');
      expect(props.inspectorCollapsed).toBe(true);
      expect(props.onToggleInspector).toBe(toggleInspector);
      expect(props.onAgentClick).toBe(profile.openAgentProfile);
      expect(props.composerTargetLabel).toBe('Test Chat');
      expect(props.selectedBlockIds).toEqual(new Set(['b1', 'b2']));
      expect(props.softHiddenBlockIds).toEqual(new Set(['h1']));
      expect(props.actionedBlockIds).toEqual(new Set(['a1']));
      expect(props.dismissedPinnedIds).toEqual(new Set(['pin-1']));
      expect(props.platform).toBe(platform);
      expect(props.showComposerAgentPicker).toBe(true);
      expect(props.showComposerStatus).toBe(false);
      expect('connectionStatus' in props).toBe(false);
      expect('workbenchStatus' in props).toBe(false);
      expect('highlightedBlockId' in props).toBe(false);
      expect('composerExecutionTargets' in props).toBe(false);
    });

    it('falls back composer target label when conversation title is missing', () => {
      const props = buildChatConversationHostProps({
        platform: platformMock() as any,
        session: sessionMock({ activeConversation: undefined }) as any,
        transcriptChrome: transcriptChromeMock() as any,
        profile: profileMock() as any,
        transcript: [],
        inspectorCollapsed: false,
        toggleInspector: vi.fn(),
        showMainchainStatus: false,
        showComposerAgentPicker: false,
        showComposerStatus: false,
      });
      expect(props.composerTargetLabel).toBe('AgentHub');
      expect('activeConversation' in props).toBe(false);
    });

    it('assigns optional host fields only when defined', () => {
      const onHighlightEnd = vi.fn();
      const targets = [{ id: 't1', label: 'Target' }];
      const props = buildChatConversationHostProps({
        platform: platformMock() as any,
        session: sessionMock() as any,
        transcriptChrome: transcriptChromeMock() as any,
        profile: profileMock() as any,
        transcript: [],
        connectionStatus: 'connected' as any,
        inspectorCollapsed: false,
        toggleInspector: vi.fn(),
        showMainchainStatus: false,
        workbenchStatus: { dataMode: 'live' },
        composerExecutionTargets: targets,
        showComposerAgentPicker: false,
        showComposerStatus: true,
        highlightedBlockId: 'hb-1',
        onHighlightEnd,
      });

      expect(props.connectionStatus).toBe('connected');
      expect(props.workbenchStatus).toEqual({ dataMode: 'live' });
      expect(props.composerExecutionTargets).toBe(targets);
      expect(props.highlightedBlockId).toBe('hb-1');
      expect(props.onHighlightEnd).toBe(onHighlightEnd);
    });

    it('adapts block select/context-menu handlers', () => {
      const session = sessionMock();
      const openBlockContextMenu = vi.fn();
      const handleBlockSelect = vi.fn();
      const transcript = [{ id: 'block-1' } as any, { id: 'block-2' } as any];
      const props = buildChatConversationHostProps({
        platform: platformMock() as any,
        session: session as any,
        transcriptChrome: transcriptChromeMock({
          openBlockContextMenu,
          handleBlockSelect,
        }) as any,
        profile: profileMock() as any,
        transcript,
        inspectorCollapsed: false,
        toggleInspector: vi.fn(),
        showMainchainStatus: false,
        showComposerAgentPicker: false,
        showComposerStatus: false,
      });

      const event = { preventDefault: vi.fn() } as any;
      props.onBlockContextMenu('block-2', event);
      expect(openBlockContextMenu).toHaveBeenCalledWith(transcript[1], event);

      props.onBlockSelect('block-1', true);
      expect(handleBlockSelect).toHaveBeenCalledWith('block-1', { shiftKey: true });

      props.onBlockSelect('block-1');
      expect(handleBlockSelect).toHaveBeenCalledWith('block-1', { shiftKey: false });
    });
  });

  describe('buildWorkbenchRoutesProps', () => {
    it('keeps required route props and omits undefined optionals', () => {
      const onAgentProfileOpen = vi.fn();
      const onNavigatePage = vi.fn();
      const settingsService = { getSettings: vi.fn() };
      const localCliDiscovery = { status: 'idle' };
      const props = buildWorkbenchRoutesProps({
        activePage: 'agents' as any,
        settingsService: settingsService as any,
        localCliDiscovery: localCliDiscovery as any,
        onAgentProfileOpen: onAgentProfileOpen as any,
        onNavigatePage,
      });

      expect(props.activePage).toBe('agents');
      expect(props.settingsService).toBe(settingsService);
      expect(props.localCliDiscovery).toBe(localCliDiscovery);
      expect(props.onAgentProfileOpen).toBe(onAgentProfileOpen);
      expect(props.onNavigatePage).toBe(onNavigatePage);
      expect('agents' in props).toBe(false);
      expect('dataMode' in props).toBe(false);
      expect('hubClient' in props).toBe(false);
      expect('skillMarketItems' in props).toBe(false);
    });

    it('assigns optional route props only when defined', () => {
      const onAgentCreate = vi.fn();
      const props = buildWorkbenchRoutesProps({
        activePage: 'projects' as any,
        agents: [{ id: 'a1' } as any],
        agentProfilesStatus: { loading: true },
        dataMode: 'live',
        contacts: { members: [] } as any,
        documents: [{ id: 'd1' } as any],
        focusedAgentId: 'a1',
        projects: [{ id: 'p1' } as any],
        activeProjectId: 'p1',
        projectsStatus: { loading: false },
        hubClient: { get: vi.fn() } as any,
        onAgentCreate,
        skillMarketItems: [{ id: 's1' } as any],
        skillMarketLoading: true,
        mcpMarketItems: [{ id: 'm1' } as any],
        mcpMarketLoading: false,
        currentUserId: 'u1',
        userDisplayName: 'User',
        settingsService: { getSettings: vi.fn() } as any,
        localCliDiscovery: { status: 'idle' } as any,
        onAgentProfileOpen: vi.fn() as any,
        onNavigatePage: vi.fn(),
      });

      expect(props.agents).toHaveLength(1);
      expect(props.agentProfilesStatus).toEqual({ loading: true });
      expect(props.dataMode).toBe('live');
      expect(props.focusedAgentId).toBe('a1');
      expect(props.activeProjectId).toBe('p1');
      expect(props.onAgentCreate).toBe(onAgentCreate);
      expect(props.skillMarketLoading).toBe(true);
      expect(props.mcpMarketLoading).toBe(false);
      expect(props.currentUserId).toBe('u1');
      expect(props.userDisplayName).toBe('User');
    });
  });

  describe('buildChatInspectorProps', () => {
    it('maps inspector chrome and width constraints', () => {
      const resizeInspectorBy = vi.fn();
      const beginInspectorResize = vi.fn();
      const platform = platformMock();
      const session = sessionMock();
      const props = buildChatInspectorProps({
        platform: platform as any,
        session: session as any,
        inspectorCollapsed: false,
        inspectorWidth: 420,
        resizeInspectorBy,
        beginInspectorResize,
      });

      expect(props.browserPreviewEnabled).toBe(true);
      expect(props.collapsed).toBe(false);
      expect(props.defaultBrowserUrl).toBe(DEFAULT_BROWSER_PREVIEW_URL);
      expect(props.evidence).toEqual([{ id: 'e1' }]);
      expect(props.maxWidth).toBe(INSPECTOR_MAX_WIDTH);
      expect(props.minWidth).toBe(INSPECTOR_MIN_WIDTH);
      expect(props.width).toBe(420);
      expect(props.onResizeBy).toBe(resizeInspectorBy);
      expect(props.onResizeStart).toBe(beginInspectorResize);
      expect(props.canOpenPreview).toBe(true);
      expect(props.onOpenPreview).toBe(platform.preview.openEvidence);
      expect(props.reviewFileRequest).toEqual({ path: '/a.ts' });
      expect(props.workDir).toBe('/tmp/work');
      expect(props.contextBlocks).toEqual([{ id: 'c1' }]);
      expect(props.routeBlocks).toEqual([{ id: 'r1' }]);
      expect(props.deployPreviewUrl).toBe('https://preview.example');
      expect(props.runResult).toEqual({ status: 'ok' });
      expect('runtimeEvidence' in props).toBe(false);
    });

    it('omits optional preview ports and blank workDir', () => {
      const props = buildChatInspectorProps({
        platform: {
          surface: 'web',
          capabilities: { browserPreview: false },
        } as any,
        session: sessionMock({
          reviewFileRequest: undefined,
          evidence: [],
          inspectorRouteBlocks: undefined,
          inspectorContextBlocks: undefined,
          inspectorDeployPreviewUrl: undefined,
          inspectorRunResult: undefined,
          composer: { workDir: '   ' },
        }) as any,
        runtimeEvidence: { runId: 'run-1' } as any,
        inspectorCollapsed: true,
        inspectorWidth: 0,
        resizeInspectorBy: vi.fn(),
        beginInspectorResize: vi.fn(),
      });

      expect(props.browserPreviewEnabled).toBe(false);
      expect(props.collapsed).toBe(true);
      expect(props.evidence).toEqual([]);
      expect(props.runtimeEvidence).toEqual({ runId: 'run-1' });
      expect('canOpenPreview' in props).toBe(false);
      expect('onOpenPreview' in props).toBe(false);
      expect('reviewFileRequest' in props).toBe(false);
      expect('workDir' in props).toBe(false);
      expect('contextBlocks' in props).toBe(false);
      expect('routeBlocks' in props).toBe(false);
      expect('deployPreviewUrl' in props).toBe(false);
      expect('runResult' in props).toBe(false);
    });
  });
});
