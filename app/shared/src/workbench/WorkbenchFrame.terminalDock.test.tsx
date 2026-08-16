import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentHubPlatform } from '../platform';
import { WorkbenchFrame } from './WorkbenchFrame';

vi.mock('./GlobalRail', () => ({
  GlobalRail: () => <div data-testid="global-rail" />,
}));

vi.mock('./WorkbenchFrameParts', () => ({
  ChatSidebarFrame: () => <div data-testid="chat-sidebar" />,
  ChatConversationHostFrame: () => <div data-testid="chat-host" />,
  ChatInspectorFrame: () => <div data-testid="chat-inspector" />,
  WorkbenchRoutesFrame: () => <div data-testid="workbench-routes" />,
  WorkspaceLoadErrorState: () => <div data-testid="load-error" />,
  WorkspaceLoadingState: () => <div data-testid="loading" />,
}));

vi.mock('./terminal', () => ({
  TerminalPanel: (props: { localTerminal?: boolean; terminal?: unknown }) => (
    <div
      data-testid="terminal-panel-stub"
      data-local-terminal={props.localTerminal ? 'true' : 'false'}
      data-has-terminal={props.terminal ? 'true' : 'false'}
    />
  ),
}));

function layoutMock() {
  return {
    inspectorWidth: 320,
    inspectorCollapsed: false,
    inspectorResizing: false,
    sidebarWidth: 260,
    sidebarCollapsed: false,
    sidebarResizing: false,
    toggleInspector: vi.fn(),
    navigateRail: vi.fn(),
    beginInspectorResize: vi.fn(),
    beginSidebarResize: vi.fn(),
    resizeInspectorBy: vi.fn(),
    resizeSidebarBy: vi.fn(),
    shellStyle: {},
  };
}

function sessionMock() {
  return {
    settingsService: { getSettings: vi.fn(), setSettings: vi.fn() },
    currentConversationId: 'conv-1',
    selectConversation: vi.fn(),
    localCliDiscovery: { status: 'idle' },
    workspaceRef: { current: null },
    handleToggleTheme: vi.fn(),
  };
}

function baseProps(platform: AgentHubPlatform, isChatPage = true) {
  return {
    platform,
    activePage: isChatPage ? ('chat' as const) : ('settings' as const),
    isChatPage,
    layout: layoutMock() as any,
    session: sessionMock() as any,
    transcriptChrome: { selectionMode: false } as any,
    profile: {
      focusedAgentId: undefined,
      openAgentProfileFromConfig: vi.fn(),
      openConversationAvatar: vi.fn(),
    } as any,
    conversations: [{ id: 'conv-1', title: 'Chat', kind: 'direct' as const }],
    transcript: [],
    setActivePage: vi.fn(),
  };
}

describe('WorkbenchFrame terminal dock (#1182)', () => {
  it('renders the dock on chat when localTerminal is true', () => {
    const platform = {
      surface: 'desktop',
      capabilities: {
        localEdge: true,
        localFiles: true,
        browserPreview: true,
        localTerminal: true,
      },
      conversations: { list: async () => [] },
      runs: { submitComposerIntent: async () => ({ intentId: 'x' }) },
    } as AgentHubPlatform;

    render(<WorkbenchFrame {...(baseProps(platform) as any)} />);

    expect(screen.getByTestId('workbench-terminal-dock')).toBeInTheDocument();
    const panel = screen.getByTestId('terminal-panel-stub');
    expect(panel.getAttribute('data-local-terminal')).toBe('true');
    expect(panel.getAttribute('data-has-terminal')).toBe('false');
  });

  it('passes platform.terminal when present', () => {
    const terminal = {
      list: vi.fn(),
      spawn: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    };
    const platform = {
      surface: 'desktop',
      capabilities: {
        localEdge: true,
        localFiles: true,
        browserPreview: true,
        localTerminal: true,
      },
      terminal,
      conversations: { list: async () => [] },
      runs: { submitComposerIntent: async () => ({ intentId: 'x' }) },
    } as AgentHubPlatform;

    render(<WorkbenchFrame {...(baseProps(platform) as any)} />);

    expect(screen.getByTestId('terminal-panel-stub').getAttribute('data-has-terminal')).toBe(
      'true',
    );
  });

  it('does not render the dock when localTerminal is false (Web)', () => {
    const platform = {
      surface: 'web',
      capabilities: {
        localEdge: false,
        localFiles: false,
        browserPreview: true,
        localTerminal: false,
      },
      conversations: { list: async () => [] },
      runs: { submitComposerIntent: async () => ({ intentId: 'x' }) },
    } as AgentHubPlatform;

    render(<WorkbenchFrame {...(baseProps(platform) as any)} />);

    expect(screen.queryByTestId('workbench-terminal-dock')).toBeNull();
    expect(screen.queryByTestId('terminal-panel-stub')).toBeNull();
  });

  it('does not render the dock on non-chat pages even when localTerminal is true', () => {
    const platform = {
      surface: 'desktop',
      capabilities: {
        localEdge: true,
        localFiles: true,
        browserPreview: true,
        localTerminal: true,
      },
      conversations: { list: async () => [] },
      runs: { submitComposerIntent: async () => ({ intentId: 'x' }) },
    } as AgentHubPlatform;

    render(<WorkbenchFrame {...(baseProps(platform, false) as any)} />);

    expect(screen.queryByTestId('workbench-terminal-dock')).toBeNull();
  });
});
