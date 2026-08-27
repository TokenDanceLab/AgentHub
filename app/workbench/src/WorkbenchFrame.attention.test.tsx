import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentHubPlatform } from '@shared/platform';
import type { WorkbenchAttentionCounts, ConversationLiveStatus } from './workbenchAttentionModel';
import { WorkbenchFrame } from './WorkbenchFrame';

/* F1/F6 + F5 (#1994) frame wiring: one attention input must feed rail,
   sidebar and the frame-level global status bar consistently, and the bar's
   click-throughs must reach the Tasks queue / the awaiting conversation. */

const railSpy = vi.fn();
const sidebarSpy = vi.fn();
const stripSpy = vi.fn();

vi.mock('./GlobalRail', () => ({
  GlobalRail: (props: { attention?: WorkbenchAttentionCounts }) => {
    railSpy(props.attention);
    return <div data-testid="global-rail" />;
  },
}));

vi.mock('./WorkbenchFrameParts', () => ({
  ChatSidebarFrame: (props: { liveStatusByConversation?: Record<string, ConversationLiveStatus> }) => {
    sidebarSpy(props.liveStatusByConversation);
    return <div data-testid="chat-sidebar" />;
  },
  ChatConversationHostFrame: () => <div data-testid="chat-host" />,
  ChatInspectorFrame: () => <div data-testid="chat-inspector" />,
  WorkbenchRoutesFrame: () => <div data-testid="workbench-routes" />,
  WorkspaceLoadErrorState: () => <div data-testid="load-error" />,
  WorkspaceLoadingState: () => <div data-testid="loading" />,
}));

vi.mock('./terminal', () => ({
  TerminalPanel: () => <div data-testid="terminal-panel-stub" />,
}));

// The real strip would need i18n; the wiring contract is what this file pins.
vi.mock('./MainchainStatusStrip', () => ({
  MainchainStatusStrip: (props: {
    attention?: WorkbenchAttentionCounts;
    onOpenRunningQueue?: () => void;
    onOpenApprovalQueue?: () => void;
  }) => {
    stripSpy(props.attention);
    return (
      <div data-testid="status-bar">
        <button data-testid="open-running" onClick={props.onOpenRunningQueue} type="button" />
        <button data-testid="open-approval" onClick={props.onOpenApprovalQueue} type="button" />
      </div>
    );
  },
}));

function renderFrame(
  attention?: {
    runs: Array<{ runId: string; projectId: string; threadId: string; status: string; createdAt: string }>;
    approvals: Array<{ id: string; runId: string; threadId: string; kind: string; summary: string; status: string; createdAt: string }>;
    threads: Array<{ id: string; projectId: string; status: string; createdAt: string; conversationId?: string }>;
  },
  overrides?: { transcript?: unknown[]; isAgentRunning?: boolean },
) {
  const navigateRail = vi.fn();
  const selectConversation = vi.fn();
  const setActivePage = vi.fn();
  railSpy.mockClear();
  sidebarSpy.mockClear();
  stripSpy.mockClear();

  const platform = {
    surface: 'desktop',
    capabilities: { localEdge: true, localFiles: false, browserPreview: false, localTerminal: false },
    conversations: { list: async () => [] },
    runs: { submitComposerIntent: async () => ({ intentId: 'x' }) },
  } as unknown as AgentHubPlatform;

  render(
    <WorkbenchFrame
      {...({
        platform,
        activePage: 'chat',
        isChatPage: true,
        layout: {
          inspectorWidth: 320,
          inspectorCollapsed: false,
          inspectorResizing: false,
          sidebarWidth: 260,
          sidebarCollapsed: false,
          sidebarResizing: false,
          toggleInspector: vi.fn(),
          navigateRail,
          beginInspectorResize: vi.fn(),
          beginSidebarResize: vi.fn(),
          resizeInspectorBy: vi.fn(),
          resizeSidebarBy: vi.fn(),
          shellStyle: {},
        },
        session: {
          settingsService: null,
          currentConversationId: 'conv-1',
          selectConversation,
          localCliDiscovery: { status: 'idle' },
          workspaceRef: { current: null },
          handleToggleTheme: vi.fn(),
        },
        transcriptChrome: { selectionMode: false },
        profile: {
          focusedAgentId: undefined,
          openAgentProfileFromConfig: vi.fn(),
          openConversationAvatar: vi.fn(),
        },
        conversations: [
          { id: 'conv-1', title: 'Active', kind: 'direct' },
          { id: 'conv-2', title: 'Waiting', kind: 'direct' },
        ],
        transcript: overrides?.transcript ?? [],
        ...(overrides?.isAgentRunning !== undefined
          ? { isAgentRunning: overrides.isAgentRunning }
          : {}),
        setActivePage,
        showComposerAgentPicker: false,
        showComposerStatus: false,
        showMainchainStatus: true,
        ...(attention ? { attention } : {}),
      } as never)}
    />,
  );
  return { navigateRail, selectConversation, setActivePage };
}

const attentionInput = {
  runs: [
    { runId: 'r1', projectId: 'p1', threadId: 't1', status: 'running', createdAt: '2026-08-25T00:00:00Z' },
    { runId: 'r2', projectId: 'p1', threadId: 't2', status: 'waiting_approval', createdAt: '2026-08-25T00:00:00Z' },
  ],
  approvals: [
    { id: 'a1', runId: 'r2', threadId: 't2', kind: 'command', summary: 's', status: 'pending', createdAt: '2026-08-25T00:00:00Z' },
  ],
  threads: [
    { id: 't1', projectId: 'p1', status: 'active', createdAt: '2026-08-25T00:00:00Z', conversationId: 'conv-1' },
    { id: 't2', projectId: 'p1', status: 'active', createdAt: '2026-08-25T00:00:00Z', conversationId: 'conv-2' },
  ],
};

describe('WorkbenchFrame attention wiring (F1/F6 + F5)', () => {
  it('derives one summary and feeds rail counts, sidebar dots and the status bar', () => {
    const { navigateRail, selectConversation, setActivePage } = renderFrame(attentionInput);

    // Last render call of each stub carries the derived props.
    const expectedSummary = {
      runningCount: 1,
      awaitingApprovalCount: 1,
      failedRunCount: 0,
      liveStatusByConversation: { 'conv-1': 'running', 'conv-2': 'awaiting-approval' },
    };
    expect(railSpy).toHaveBeenLastCalledWith(expectedSummary);
    expect(sidebarSpy).toHaveBeenLastCalledWith(expectedSummary.liveStatusByConversation);
    expect(stripSpy).toHaveBeenLastCalledWith(expectedSummary);

    // Running chip routes to the Tasks queue through the rail navigation.
    fireEvent.click(screen.getByTestId('open-running'));
    expect(navigateRail).toHaveBeenCalledWith('runs');

    // Approval chip on the chat page without a local pending block returns to
    // chat and switches to the awaiting conversation.
    fireEvent.click(screen.getByTestId('open-approval'));
    expect(setActivePage).toHaveBeenCalledWith('chat');
    expect(selectConversation).toHaveBeenCalledWith('conv-2');
  });

  it('keeps all attention chrome absent when nothing is observable', () => {
    // No inventory AND no active-conversation signal (empty transcript,
    // unknown runtime flag) — the fallback derives undefined, not zeros.
    renderFrame();
    expect(railSpy).toHaveBeenLastCalledWith(undefined);
    expect(sidebarSpy).toHaveBeenLastCalledWith(undefined);
    expect(stripSpy).toHaveBeenLastCalledWith(undefined);
  });

  it('falls back to active-conversation scope without an inventory', () => {
    // One pending permission_request block in the active transcript +
    // runtime running flag: counts are real but cover conv-1 only.
    renderFrame(undefined, {
      transcript: [
        {
          kind: 'permission_request',
          id: 'pr-1',
          author: { id: 'agent', name: 'Agent', role: 'agent' },
        },
      ],
      isAgentRunning: true,
    });

    const expectedScoped = {
      runningCount: 1,
      awaitingApprovalCount: 1,
      activeConversationOnly: true,
      liveStatusByConversation: { 'conv-1': 'running' },
    };
    expect(railSpy).toHaveBeenLastCalledWith(expectedScoped);
    expect(sidebarSpy).toHaveBeenLastCalledWith({ 'conv-1': 'running' });
    expect(stripSpy).toHaveBeenLastCalledWith(expectedScoped);
  });

  it('approval chip jumps within the active transcript when it has a pending block', () => {
    // Active conversation owns the pending approval: the frame dispatches the
    // transient jump intent instead of switching conversations.
    renderFrame(undefined, {
      transcript: [
        {
          kind: 'permission_request',
          id: 'pr-1',
          author: { id: 'agent', name: 'Agent', role: 'agent' },
        },
      ],
      isAgentRunning: true,
    });
    const heard: Array<{ conversationId?: string }> = [];
    const listener = (event: Event): void => {
      heard.push((event as CustomEvent<{ conversationId?: string }>).detail);
    };
    window.addEventListener('agenthub:approval-jump', listener);
    fireEvent.click(screen.getByTestId('open-approval'));
    window.removeEventListener('agenthub:approval-jump', listener);
    expect(heard).toEqual([{ conversationId: 'conv-1' }]);
  });
});
