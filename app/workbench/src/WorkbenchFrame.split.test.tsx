// real_tested=true
import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentHubPlatform, WorkbenchConversation } from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript';
import { SPLIT_LAYOUT_STORAGE_KEY } from './workbenchLayoutConstants';
import { useWorkbenchPanelLayout, type WorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import { WorkbenchFrame } from './WorkbenchFrame';
import { useTestI18nLanguage } from '@shared/testing/i18n';

/* ═══════════════════════════════════════════════════════════════════════
   WorkbenchFrame split-view wiring (#1997, UX F3).

   Behavior contracts under test (menu chrome itself is covered by
   WorkspaceHeader.split.test.tsx; here the split state is driven through
   the real hook API the menu is wired to):
   - honesty gate: no split entry with fewer than two conversations;
   - Split Right/Down adds a pane WITHOUT remounting the active host
     (mount-id probe on the mocked ChatConversationHostFrame);
   - sidebar selection drops into the inactive pane (parallel review);
   - Unsplit restores the single group;
   - corrupted persisted layout blobs fall back to a single group.
   ═══════════════════════════════════════════════════════════════════════ */

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

// ConversationSidebar virtualization needs a layout engine jsdom lacks.
vi.mock('virtua', () => ({
  Virtualizer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./GlobalRail', () => ({
  GlobalRail: () => <div data-testid="global-rail" />,
}));

vi.mock('./MainchainStatusStrip', () => ({
  MainchainStatusStrip: () => <div data-testid="status-bar" />,
}));

vi.mock('./terminal', () => ({
  TerminalPanel: () => <div data-testid="terminal-panel-stub" />,
}));

/** Mount sequence probe: a fresh mount (forbidden during layout changes)
 *  allocates a new mount id visible in the DOM. */
let hostMountSequence = 0;
function MockConversationHost(props: { splitControls?: unknown }): React.ReactElement {
  const mountId = useRef(0);
  if (mountId.current === 0) {
    hostMountSequence += 1;
    mountId.current = hostMountSequence;
  }
  return (
    <div
      data-testid="chat-host"
      data-mount-id={mountId.current}
      data-has-split-controls={props.splitControls ? 'true' : 'false'}
      role="log"
    >
      mock transcript
    </div>
  );
}

vi.mock('./WorkbenchFrameParts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./WorkbenchFrameParts')>();
  return {
    ...actual,
    ChatConversationHostFrame: (props: { splitControls?: unknown }) => (
      <MockConversationHost {...(props.splitControls ? { splitControls: props.splitControls } : {})} />
    ),
    // The inspector column is not under test here and needs full composer state.
    ChatInspectorFrame: () => <div data-testid="chat-inspector" />,
  };
});

vi.mock('./SplitConversationPane', () => ({
  SplitConversationPane: (props: {
    paneId: string;
    conversation?: { id: string; title: string };
    onFocus: () => void;
    onClose: () => void;
  }) => (
    <div data-testid={`read-only-pane-${props.paneId}`} data-conversation={props.conversation?.id ?? ''}>
      <span>{props.conversation?.title ?? 'empty'}</span>
      <button data-testid={`focus-${props.paneId}`} onClick={props.onFocus} type="button">focus</button>
      <button data-testid={`close-${props.paneId}`} onClick={props.onClose} type="button">close</button>
    </div>
  ),
}));

const TWO_CONVERSATIONS: WorkbenchConversation[] = [
  { id: 'conv-a', title: 'Alpha', kind: 'direct' },
  { id: 'conv-b', title: 'Beta', kind: 'direct' },
];

const TEXT_BLOCK = {
  id: 'block-1',
  kind: 'text',
  role: 'agent',
  text: 'hello',
} as unknown as TranscriptBlock;

interface LayoutHolder {
  layout: WorkbenchPanelLayout | null;
}

interface HarnessOptions {
  conversations?: WorkbenchConversation[];
  initialConversationId?: string;
  layoutHolder?: LayoutHolder;
}

/** Real useWorkbenchPanelLayout + real WorkbenchFrame; session chrome reduced
 *  to the fields the frame reads. */
function SplitHarness({ conversations, initialConversationId, layoutHolder }: HarnessOptions): React.ReactElement {
  const [activeId, setActiveId] = useState(initialConversationId ?? 'conv-a');
  const layout = useWorkbenchPanelLayout({
    activePage: 'chat',
    isChatPage: true,
    platformSurface: 'web',
    setActivePage: () => {},
    activeConversationId: activeId,
  });
  if (layoutHolder) layoutHolder.layout = layout;

  const platform = {
    surface: 'web',
    capabilities: { localEdge: false, localFiles: false, browserPreview: false, localTerminal: false },
    conversations: { list: async () => [] },
    runs: { submitComposerIntent: async () => ({ intentId: 'x' }) },
  } as unknown as AgentHubPlatform;

  return (
    <WorkbenchFrame
      {...({
        platform,
        activePage: 'chat',
        isChatPage: true,
        layout,
        session: {
          settingsService: null,
          currentConversationId: activeId,
          selectConversation: setActiveId,
          localCliDiscovery: { status: 'idle' },
          sessionImportItems: [],
          sessionImportLoading: false,
          sessionImportError: null,
          sessionImportVisible: false,
          refreshSessionImport: () => {},
          workspaceRef: { current: null },
          handleToggleTheme: () => {},
        },
        transcriptChrome: { selectionMode: false },
        profile: {
          focusedAgentId: undefined,
          openAgentProfileFromConfig: () => {},
          openConversationAvatar: () => {},
        },
        conversations,
        transcript: [TEXT_BLOCK],
        setActivePage: () => {},
        showComposerAgentPicker: false,
        showComposerStatus: false,
        showMainchainStatus: false,
      } as never)}
    />
  );
}

function renderSplit(options: HarnessOptions = {}) {
  hostMountSequence = 0;
  const layoutHolder: LayoutHolder = { layout: null };
  const utils = render(
    <SplitHarness
      conversations={options.conversations ?? TWO_CONVERSATIONS}
      layoutHolder={layoutHolder}
      {...(options.initialConversationId ? { initialConversationId: options.initialConversationId } : {})}
    />,
  );
  return { ...utils, layoutHolder };
}

function splitVia(holder: LayoutHolder, orientation: 'horizontal' | 'vertical'): void {
  act(() => holder.layout?.split?.splitActivePane(orientation));
}

/** Sidebar rows bind onClick to the inner .conversationRow div, not the li. */
function clickConversationRow(title: string): void {
  const option = screen.getAllByRole('option').find((item) => item.textContent?.includes(title));
  expect(option, `sidebar option for ${title}`).toBeTruthy();
  const row = (option as HTMLElement).firstElementChild as HTMLElement | null;
  expect(row, `row element for ${title}`).toBeTruthy();
  fireEvent.click(row as HTMLElement);
}

function activeMountId(): string {
  const host = document.querySelector('[data-split-active="true"] [data-testid="chat-host"]')
    ?? document.querySelector('[data-testid="chat-host"]');
  return host?.getAttribute('data-mount-id') ?? '';
}

describe('WorkbenchFrame split view wiring (#1997)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('hides every split entry with fewer than two conversations (honesty gate)', () => {
    renderSplit({ conversations: [{ id: 'conv-a', title: 'Alpha', kind: 'direct' }] });
    expect(document.querySelector('[data-testid="chat-host"]')?.getAttribute('data-has-split-controls')).toBe('false');
    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(1);
  });

  it('renders a single full pane before any split action', () => {
    renderSplit();
    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(1);
    expect(document.querySelector('main[data-split]')).toBeNull();
    // The host receives split controls (the entry point lives in its header).
    expect(screen.getByTestId('chat-host').getAttribute('data-has-split-controls')).toBe('true');
  });

  it('Split Right adds a pane without remounting the active host', () => {
    const { layoutHolder } = renderSplit();
    const mountBefore = activeMountId();
    expect(mountBefore).not.toBe('');

    splitVia(layoutHolder, 'horizontal');

    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(2);
    expect(document.querySelector('main[data-split="true"]')).not.toBeNull();
    expect(activeMountId()).toBe(mountBefore);
    // The active pane keeps the live host; the fresh sibling is empty.
    const activePane = document.querySelector('[data-split-active="true"]');
    expect(activePane?.getAttribute('data-conversation-id')).toBe('conv-a');
    expect(activePane?.querySelector('[data-testid="chat-host"]')).not.toBeNull();
    const inactivePane = document.querySelector('[data-split-active="false"]');
    expect(inactivePane?.getAttribute('data-conversation-id')).toBe('');
  });

  it('Split Down stacks vertically and Unsplit restores the single group', () => {
    const { layoutHolder } = renderSplit();
    const mountBefore = activeMountId();

    splitVia(layoutHolder, 'vertical');
    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(2);

    act(() => layoutHolder.layout?.split?.collapseAll());
    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(1);
    expect(document.querySelector('main[data-split]')).toBeNull();
    expect(activeMountId()).toBe(mountBefore);
    // Collapse persists as "no layout" (single group is not a stored tree).
    expect(window.localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it('sidebar selection drops the conversation into the inactive pane', () => {
    const { layoutHolder } = renderSplit();
    splitVia(layoutHolder, 'horizontal');

    // Click conversation Beta in the real sidebar list.
    clickConversationRow('Beta');

    // Beta became active in the second pane; Alpha stays visible read-only.
    const activePane = document.querySelector('[data-split-active="true"]');
    expect(activePane?.getAttribute('data-conversation-id')).toBe('conv-b');
    const inactivePane = document.querySelector('[data-split-active="false"]');
    expect(inactivePane?.getAttribute('data-conversation-id')).toBe('conv-a');
    expect(inactivePane?.textContent).toContain('Alpha');
    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(2);
  });

  it('clicking a conversation already open only refocuses its pane', () => {
    const { layoutHolder } = renderSplit();
    splitVia(layoutHolder, 'horizontal');
    clickConversationRow('Beta');
    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(2);

    // Alpha is in the inactive pane — selecting it in the sidebar refocuses
    // that pane instead of opening a third surface.
    clickConversationRow('Alpha');
    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(2);
    const activePane = document.querySelector('[data-split-active="true"]');
    expect(activePane?.getAttribute('data-conversation-id')).toBe('conv-a');
  });

  it('closing an inactive pane keeps the active host mounted', () => {
    const { layoutHolder } = renderSplit();
    const mountBefore = activeMountId();
    splitVia(layoutHolder, 'horizontal');

    const inactivePane = document.querySelector('[data-split-active="false"]');
    const paneId = inactivePane?.getAttribute('data-pane-id') ?? '';
    fireEvent.click(screen.getByTestId(`close-${paneId}`));

    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(1);
    expect(activeMountId()).toBe(mountBefore);
  });

  it('persists the layout and re-hydrates it on the next mount', () => {
    const first = renderSplit();
    splitVia(first.layoutHolder, 'horizontal');
    const blob = window.localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY);
    expect(blob).not.toBeNull();
    first.unmount();

    renderSplit();
    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(2);
  });

  it('falls back to a single group when the persisted blob is hostile', () => {
    window.localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, '{"v":1,"root":{"kind":"split","orientation":"horizontal","children":[],"ratios":[]}}');
    renderSplit();
    expect(document.querySelectorAll('[data-split-pane]')).toHaveLength(1);
    // The honesty gate still offers the entry — two conversations exist.
    expect(screen.getByTestId('chat-host').getAttribute('data-has-split-controls')).toBe('true');
  });

  it('keeps the legacy direct host rendering when layout has no split wiring', () => {
    // Surfaces that pass a layout without the split field (fixtures, legacy
    // shells) render the host directly — no pane shell, no split entry.
    const platform = {
      surface: 'web',
      capabilities: { localEdge: false, localFiles: false, browserPreview: false, localTerminal: false },
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
            toggleInspector: () => {},
            navigateRail: () => {},
            beginInspectorResize: () => {},
            beginSidebarResize: () => {},
            resizeInspectorBy: () => {},
            resizeSidebarBy: () => {},
            shellStyle: {},
          },
          session: {
            settingsService: null,
            currentConversationId: 'conv-a',
            selectConversation: () => {},
            localCliDiscovery: { status: 'idle' },
            sessionImportItems: [],
            sessionImportLoading: false,
            sessionImportError: null,
            sessionImportVisible: false,
            refreshSessionImport: () => {},
            workspaceRef: { current: null },
            handleToggleTheme: () => {},
          },
          transcriptChrome: { selectionMode: false },
          profile: {
            focusedAgentId: undefined,
            openAgentProfileFromConfig: () => {},
            openConversationAvatar: () => {},
          },
          conversations: TWO_CONVERSATIONS,
          transcript: [TEXT_BLOCK],
          setActivePage: () => {},
          showComposerAgentPicker: false,
          showComposerStatus: false,
          showMainchainStatus: false,
        } as never)}
      />,
    );

    expect(document.querySelector('[data-split-pane]')).toBeNull();
    expect(screen.getByTestId('chat-host').getAttribute('data-has-split-controls')).toBe('false');
    expect(screen.getByTestId('chat-host')).not.toBeNull();
  });
});
