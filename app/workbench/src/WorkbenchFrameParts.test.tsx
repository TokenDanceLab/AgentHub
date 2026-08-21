import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatSidebarFrame,
  ChatConversationHostFrame,
  ChatInspectorFrame,
  WorkbenchRoutesFrame,
  WorkspaceLoadErrorState,
  WorkspaceLoadingState,
} from './WorkbenchFrameParts';

/* ==========================================================================
   WorkbenchFrameParts smoke tests (#698)

   Verify each frame component renders its child and forwards the key
   wiring props.  No visual regression -- pure structural signal.
   ========================================================================== */

/** Last ConversationHost props seen by the mock (referential-stability gate). */
const hostPropsLog = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock('./ConversationSidebar', () => ({
  ConversationSidebar: (props: Record<string, unknown>) => (
    <div data-testid="sidebar" data-active-id={props.activeConversationId as string}>
      {/* #1835 review: a focusable descendant so the collapsed-sidebar test
          can prove `inert` (not just aria-hidden) blocks Tab focus. */}
      <input aria-label="aria.searchConversations" data-testid="sidebar-search" />
    </div>
  ),
}));

vi.mock('./ConversationHost', () => ({
  ConversationHost: (props: Record<string, unknown>) => {
    hostPropsLog.last = props;
    return (
      <div
        data-testid="conversation-host"
        data-current-id={props.currentConversationId as string}
        data-inspector-collapsed={props.inspectorCollapsed ? 'true' : 'false'}
      />
    );
  },
}));

vi.mock('./RightInspector', () => ({
  RightInspector: (props: Record<string, unknown>) => (
    <div
      data-testid="right-inspector"
      data-collapsed={props.collapsed ? 'true' : 'false'}
      data-width={props.width as number}
      data-min-width={props.minWidth as number}
      data-max-width={props.maxWidth as number}
    />
  ),
}));

vi.mock('./ChatEngineeringColumn', () => ({
  ChatEngineeringColumn: (props: Record<string, unknown>) => (
    <div
      data-testid="chat-engineering-column"
      data-has-workspace={props.hasWorkspace ? 'true' : 'false'}
      data-local-files={props.localFiles ? 'true' : 'false'}
    >
      {props.inspector as React.ReactNode}
    </div>
  ),
}));

vi.mock('./WorkbenchRoutes', () => ({
  WorkbenchRoutes: (props: Record<string, unknown>) => (
    <div data-testid="workbench-routes" data-active-page={props.activePage as string} />
  ),
}));

// -- Test helpers -------------------------------------------------------

function sessionMock(overrides: Record<string, unknown> = {}) {
  return {
    currentConversationId: 'conv-1',
    activeConversation: { id: 'conv-1', title: 'Test Chat' },
    selectedExecutionTargetId: 'agent-1',
    setSelectedExecutionTargetId: vi.fn(),
    dismissedPinnedIds: new Set<string>(),
    searchOpen: false,
    setSearchOpen: vi.fn(),
    composerInputRef: { current: null },
    composer: { workDir: '/tmp' },
    dispatchComposer: vi.fn(),
    mainchainSummary: null,
    mentionableAgents: [],
    openReviewFile: vi.fn(),
    handleDeploySubmit: vi.fn(),
    exportMainchainEvidence: vi.fn(),
    reviewFileRequest: { path: '/a.ts' },
    evidence: null,
    inspectorRouteBlocks: [],
    inspectorContextBlocks: [],
    inspectorDeployPreviewUrl: null,
    inspectorRunResult: null,
    settingsService: { getSettings: vi.fn(), setSettings: vi.fn() },
    localCliDiscovery: { status: 'idle' },
    sessionImportItems: [],
    sessionImportLoading: false,
    sessionImportError: null,
    sessionImportVisible: false,
    refreshSessionImport: vi.fn(),
    selectConversation: vi.fn(),
    workspaceRef: { current: null },
    handleToggleTheme: vi.fn(),
    ...overrides,
  };
}

function transcriptChromeMock(overrides: Record<string, unknown> = {}) {
  return {
    selectionMode: false,
    selectedBlockIds: [] as string[],
    softHiddenBlockIds: [] as string[],
    actionedBlockIds: [] as string[],
    showWorkbenchToast: vi.fn(),
    openBlockContextMenu: vi.fn(),
    handleBlockSelect: vi.fn(),
    handleTranscriptBlockAction: vi.fn(),
    ...overrides,
  };
}

function profileMock(overrides: Record<string, unknown> = {}) {
  return {
    openAgentProfile: vi.fn(),
    openAgentProfileFromConfig: vi.fn(),
    openConversationAvatar: vi.fn(),
    focusedAgentId: undefined,
    ...overrides,
  };
}

function platformMock(overrides: {
  surface?: string;
  capabilities?: Record<string, unknown>;
  preview?: Record<string, unknown>;
} = {}) {
  return {
    surface: overrides.surface ?? 'web',
    capabilities: {
      browserPreview: true,
      localFiles: false,
      ...(overrides.capabilities ?? {}),
    },
    preview: overrides.preview ?? { canOpenEvidence: false, openEvidence: vi.fn() },
  };
}

// -- Tests --------------------------------------------------------------

describe('WorkbenchFrameParts', () => {
  describe('WorkspaceLoadingState', () => {
    it('renders a status label', () => {
      render(<WorkspaceLoadingState label="Loading..." />);
      expect(screen.getByText('Loading...')).toBeTruthy();
    });

    it('uses role status', () => {
      render(<WorkspaceLoadingState label="Wait" />);
      expect(screen.getByRole('status')).toBeTruthy();
    });
  });

  describe('WorkspaceLoadErrorState', () => {
    it('renders RecoveryPanel with load error meta and retry', () => {
      const onRetry = vi.fn();
      render(
        <WorkspaceLoadErrorState
          title="Failed to load chat"
          description="Chat data could not be loaded."
          meta="network down"
          retryLabel="Retry"
          onRetry={onRetry}
        />,
      );
      // RecoveryPanel exposes role=alert with the error content.
      expect(screen.getByRole('alert', { name: 'Failed to load chat' })).toBeTruthy();
      expect(screen.getByText('Chat data could not be loaded.')).toBeTruthy();
      expect(screen.getByText('network down')).toBeTruthy();
      screen.getByRole('button', { name: /Retry/i }).click();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('ChatSidebarFrame', () => {
    it('renders sidebar with active conversation id', () => {
      render(
        <ChatSidebarFrame
          conversations={[
            { id: 'c1', title: 'One', createdAt: '' } as any,
            { id: 'c2', title: 'Two', createdAt: '' } as any,
          ]}
          currentConversationId="c1"
          onSelectConversation={vi.fn()}
          onAvatarClick={vi.fn()}
          sidebarWidth={260}
          sidebarCollapsed={false}
          resizeSidebarBy={vi.fn()}
          beginSidebarResize={vi.fn()}
        />,
      );
      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar.getAttribute('data-active-id')).toBe('c1');
    });

    it('renders sidebar resizer with separator role', () => {
      render(
        <ChatSidebarFrame
          conversations={[]}
          currentConversationId="c1"
          onSelectConversation={vi.fn()}
          onAvatarClick={vi.fn()}
          sidebarWidth={260}
          sidebarCollapsed={false}
          resizeSidebarBy={vi.fn()}
          beginSidebarResize={vi.fn()}
        />,
      );
      expect(screen.getByRole('separator')).toBeTruthy();
    });

    it('removes the resizer from the accessibility tree when the sidebar is collapsed', () => {
      render(
        <ChatSidebarFrame
          conversations={[]}
          currentConversationId="c1"
          onSelectConversation={vi.fn()}
          onAvatarClick={vi.fn()}
          sidebarWidth={0}
          sidebarCollapsed={true}
          resizeSidebarBy={vi.fn()}
          beginSidebarResize={vi.fn()}
        />,
      );
      // #1823: `inert` on the collapsed frame removes the whole subtree —
      // resizer included — from the a11y tree (stronger than tabindex=-1).
      expect(screen.queryByRole('separator')).not.toBeInTheDocument();
      expect(screen.getByRole('separator', { hidden: true })).toBeInTheDocument();
      // #1835 review: a focusable descendant (the sidebar search input) must
      // also be unreachable — being inside the inert subtree is what blocks
      // Tab focus, not just the aria-hidden flag.
      const searchInput = screen.getByTestId('sidebar-search');
      expect(searchInput.closest('[inert]')).not.toBeNull();
      expect(screen.queryByRole('textbox', { name: 'aria.searchConversations' })).not.toBeInTheDocument();
    });

    it('keeps the sidebar search input focusable when expanded', () => {
      render(
        <ChatSidebarFrame
          conversations={[]}
          currentConversationId="c1"
          onSelectConversation={vi.fn()}
          onAvatarClick={vi.fn()}
          sidebarWidth={260}
          sidebarCollapsed={false}
          resizeSidebarBy={vi.fn()}
          beginSidebarResize={vi.fn()}
        />,
      );
      const searchInput = screen.getByTestId('sidebar-search');
      expect(searchInput.closest('[inert]')).toBeNull();
      expect(screen.getByRole('textbox', { name: 'aria.searchConversations' })).toBeInTheDocument();
    });
  });

  describe('ChatConversationHostFrame', () => {
    it('wires currentConversationId to ConversationHost', () => {
      const session = sessionMock({ currentConversationId: 'conv-x' });
      render(
        <ChatConversationHostFrame
          platform={platformMock() as any}
          session={session as any}
          transcriptChrome={transcriptChromeMock() as any}
          profile={profileMock() as any}
          transcript={[]}
          inspectorCollapsed={false}
          toggleInspector={vi.fn()}
          showMainchainStatus={false}
          showComposerAgentPicker={false}
          showComposerStatus={false}
        />,
      );
      const host = screen.getByTestId('conversation-host');
      expect(host.getAttribute('data-current-id')).toBe('conv-x');
    });

    it('forwards inspectorCollapsed flag', () => {
      const session = sessionMock();
      render(
        <ChatConversationHostFrame
          platform={platformMock() as any}
          session={session as any}
          transcriptChrome={transcriptChromeMock() as any}
          profile={profileMock() as any}
          transcript={[]}
          inspectorCollapsed={true}
          toggleInspector={vi.fn()}
          showMainchainStatus={false}
          showComposerAgentPicker={false}
          showComposerStatus={false}
        />,
      );
      expect(screen.getByTestId('conversation-host').getAttribute('data-inspector-collapsed')).toBe('true');
    });

    it('handles undefined workbenchStatus gracefully', () => {
      const session = sessionMock();
      render(
        <ChatConversationHostFrame
          platform={platformMock() as any}
          session={session as any}
          transcriptChrome={transcriptChromeMock() as any}
          profile={profileMock() as any}
          transcript={[]}
          inspectorCollapsed={false}
          toggleInspector={vi.fn()}
          showMainchainStatus={false}
          workbenchStatus={undefined}
          showComposerAgentPicker={false}
          showComposerStatus={false}
        />,
      );
      expect(screen.getByTestId('conversation-host')).toBeTruthy();
    });

    it('feeds referentially stable derived props to ConversationHost across re-renders (memo gate)', () => {
      const frameProps = {
        platform: platformMock() as any,
        session: sessionMock() as any,
        transcriptChrome: transcriptChromeMock() as any,
        profile: profileMock() as any,
        transcript: [{ id: 't1' }] as any,
        inspectorCollapsed: false,
        toggleInspector: vi.fn(),
        showMainchainStatus: false,
        showComposerAgentPicker: false,
        showComposerStatus: false,
      };
      const { rerender } = render(<ChatConversationHostFrame {...frameProps} />);
      const first = hostPropsLog.last!;
      rerender(<ChatConversationHostFrame {...frameProps} />);
      const second = hostPropsLog.last!;

      expect(second.onBlockContextMenu).toBe(first.onBlockContextMenu);
      expect(second.onBlockSelect).toBe(first.onBlockSelect);
      expect(second.selectedBlockIds).toBe(first.selectedBlockIds);
      expect(second.softHiddenBlockIds).toBe(first.softHiddenBlockIds);
      expect(second.actionedBlockIds).toBe(first.actionedBlockIds);
    });
  });

  describe('ChatInspectorFrame', () => {
    it('forwards collapsed state and width constraints', () => {
      const session = sessionMock();
      render(
        <ChatInspectorFrame
          platform={platformMock() as any}
          session={session as any}
          inspectorCollapsed={false}
          inspectorWidth={400}
          resizeInspectorBy={vi.fn()}
          beginInspectorResize={vi.fn()}
        />,
      );
      const inspector = screen.getByTestId('right-inspector');
      expect(inspector.getAttribute('data-collapsed')).toBe('false');
      expect(inspector.getAttribute('data-width')).toBe('400');
      // min/max from workbenchLayoutConstants
      expect(inspector.getAttribute('data-min-width')).toBeTruthy();
      expect(inspector.getAttribute('data-max-width')).toBeTruthy();
    });

    it('forwards runtime evidence when provided', () => {
      const session = sessionMock();
      const evidence = { summary: 'test evidence' } as any;
      render(
        <ChatInspectorFrame
          platform={platformMock() as any}
          session={session as any}
          runtimeEvidence={evidence}
          inspectorCollapsed={true}
          inspectorWidth={0}
          resizeInspectorBy={vi.fn()}
          beginInspectorResize={vi.fn()}
        />,
      );
      expect(screen.getByTestId('right-inspector')).toBeTruthy();
    });

    it('does not mount AuxPanel column when localFiles is false (Web)', () => {
      const session = sessionMock({ composer: { workDir: '/tmp/workspace' } });
      render(
        <ChatInspectorFrame
          platform={platformMock({ surface: 'web', capabilities: { localFiles: false } }) as any}
          session={session as any}
          inspectorCollapsed={false}
          inspectorWidth={400}
          resizeInspectorBy={vi.fn()}
          beginInspectorResize={vi.fn()}
        />,
      );
      expect(screen.getByTestId('right-inspector')).toBeTruthy();
      expect(screen.queryByTestId('chat-engineering-column')).toBeNull();
      expect(screen.queryByTestId('aux-panel')).toBeNull();
    });

    it('stacks AuxPanel column when localFiles is true (Desktop)', () => {
      const session = sessionMock({ composer: { workDir: '/tmp/workspace' } });
      render(
        <ChatInspectorFrame
          platform={
            platformMock({
              surface: 'desktop',
              capabilities: { localFiles: true, browserPreview: true },
            }) as any
          }
          session={session as any}
          inspectorCollapsed={false}
          inspectorWidth={400}
          resizeInspectorBy={vi.fn()}
          beginInspectorResize={vi.fn()}
        />,
      );
      const column = screen.getByTestId('chat-engineering-column');
      expect(column.getAttribute('data-local-files')).toBe('true');
      expect(column.getAttribute('data-has-workspace')).toBe('true');
      expect(screen.getByTestId('right-inspector')).toBeTruthy();
    });

    it('marks hasWorkspace false when workDir is empty even with localFiles', () => {
      const session = sessionMock({ composer: { workDir: '   ' } });
      render(
        <ChatInspectorFrame
          platform={
            platformMock({
              surface: 'desktop',
              capabilities: { localFiles: true },
            }) as any
          }
          session={session as any}
          inspectorCollapsed={false}
          inspectorWidth={400}
          resizeInspectorBy={vi.fn()}
          beginInspectorResize={vi.fn()}
        />,
      );
      expect(screen.getByTestId('chat-engineering-column').getAttribute('data-has-workspace')).toBe(
        'false',
      );
    });
  });

  describe('WorkbenchRoutesFrame', () => {
    it('forwards activePage to WorkbenchRoutes', () => {
      const session = sessionMock();
      render(
        <WorkbenchRoutesFrame
          activePage={'agents' as any}
          agents={[]}
          settingsService={session.settingsService as any}
          localCliDiscovery={session.localCliDiscovery as any}
          sessionImportItems={session.sessionImportItems as any}
          sessionImportLoading={session.sessionImportLoading as any}
          sessionImportError={session.sessionImportError as any}
          sessionImportVisible={session.sessionImportVisible as any}
          onRefreshSessionImport={session.refreshSessionImport as any}
          onAgentProfileOpen={vi.fn() as any}
          onNavigatePage={vi.fn()}
        />,
      );
      expect(screen.getByTestId('workbench-routes').getAttribute('data-active-page')).toBe('agents');
    });

    it('renders workbench page host section', () => {
      const session = sessionMock();
      render(
        <WorkbenchRoutesFrame
          activePage={'settings' as any}
          agents={[]}
          settingsService={session.settingsService as any}
          localCliDiscovery={session.localCliDiscovery as any}
          sessionImportItems={session.sessionImportItems as any}
          sessionImportLoading={session.sessionImportLoading as any}
          sessionImportError={session.sessionImportError as any}
          sessionImportVisible={session.sessionImportVisible as any}
          onRefreshSessionImport={session.refreshSessionImport as any}
          onAgentProfileOpen={vi.fn() as any}
          onNavigatePage={vi.fn()}
        />,
      );
      expect(screen.getByTestId('workbench-routes')).toBeTruthy();
    });

    it('handles optional props as undefined', () => {
      const session = sessionMock();
      render(
        <WorkbenchRoutesFrame
          activePage={'projects' as any}
          agents={undefined}
          agentProfilesStatus={undefined}
          dataMode={undefined}
          contacts={undefined}
          documents={undefined}
          focusedAgentId={undefined}
          projects={undefined}
          activeProjectId={undefined}
          projectsStatus={undefined}
          projectsPort={undefined}
          ccSwitchStatus={undefined}
          ccSwitchProviders={undefined}
          skillMarketItems={undefined}
          mcpMarketItems={undefined}
          contactsActions={undefined}
          documentsActions={undefined}
          settingsService={session.settingsService as any}
          localCliDiscovery={session.localCliDiscovery as any}
          sessionImportItems={session.sessionImportItems as any}
          sessionImportLoading={session.sessionImportLoading as any}
          sessionImportError={session.sessionImportError as any}
          sessionImportVisible={session.sessionImportVisible as any}
          onRefreshSessionImport={session.refreshSessionImport as any}
          onAgentProfileOpen={vi.fn() as any}
          onNavigatePage={vi.fn()}
        />,
      );
      expect(screen.getByTestId('workbench-routes')).toBeTruthy();
    });
  });
});
