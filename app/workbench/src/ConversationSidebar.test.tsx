import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { WorkbenchConversation } from '@shared/platform';
import { ConversationSidebar } from './ConversationSidebar';
import type { TaskItem } from './pages';
import {
  backFromTaskDeepLink,
  consumeWorkbenchTaskDeepLinkIntent,
  getWorkbenchTaskDeepLinkSnapshot,
  openConversationForTask,
  publishWorkbenchTaskQueue,
  resetWorkbenchTaskDeepLinksForTest,
} from './workbenchTaskDeepLinks';

/* ──────────────────────────────────────────────────────────────────────
   ConversationSidebar actions tests (#1508): rename / copy link / delete.
   jsdom has no layout engine, so virtua is mocked with a passthrough.
   ────────────────────────────────────────────────────────────────────── */

// These assertions use the en chatview literals; opt into the en bundle of
// the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

vi.mock('virtua', () => ({
  Virtualizer: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const baseConversations: WorkbenchConversation[] = [
  { id: 'c1', title: 'First chat', kind: 'direct' },
  { id: 'c2', title: 'Second chat', kind: 'direct' },
];

function renderSidebar(
  overrides: Partial<Parameters<typeof ConversationSidebar>[0]> = {},
) {
  const props = {
    conversations: baseConversations,
    activeConversationId: 'c1',
    onRenameConversation: vi.fn(),
    onDeleteConversation: vi.fn(),
    onCopyConversationLink: vi.fn(),
    ...overrides,
  };
  const view = render(<ConversationSidebar {...props} />);
  return { ...view, props };
}

function openContextMenu(rowTitle: string) {
  fireEvent.contextMenu(screen.getByText(rowTitle).closest('button')!);
}

describe('ConversationSidebar actions (#1508)', () => {
  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  describe('context menu actions', () => {
    it('renders rename / copy link / delete actions in the context menu', () => {
      renderSidebar();
      openContextMenu('First chat');
      expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    it('does not render the new actions when their callbacks are absent', () => {
      renderSidebar({
        onRenameConversation: undefined,
        onDeleteConversation: undefined,
        onCopyConversationLink: undefined,
        onPinConversation: vi.fn(),
      });
      openContextMenu('First chat');
      expect(screen.getByRole('menuitem', { name: '置顶' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Copy link' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    });
  });

  describe('inline rename', () => {
    it('commits the new title with Enter through the rename callback', async () => {
      const user = userEvent.setup();
      const { props } = renderSidebar();
      openContextMenu('First chat');
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByRole('textbox', { name: 'Rename conversation' });
      expect(input).toHaveValue('First chat');
      await user.clear(input);
      await user.type(input, 'Renamed chat');
      await user.keyboard('{Enter}');

      expect(props.onRenameConversation).toHaveBeenCalledOnce();
      expect(props.onRenameConversation).toHaveBeenCalledWith('c1', 'Renamed chat');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('cancels the inline rename with Escape without calling the callback', async () => {
      const user = userEvent.setup();
      const { props } = renderSidebar();
      openContextMenu('First chat');
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByRole('textbox', { name: 'Rename conversation' });
      await user.clear(input);
      await user.type(input, 'Should not stick');
      await user.keyboard('{Escape}');

      expect(props.onRenameConversation).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('does not report an unchanged or empty title', async () => {
      const user = userEvent.setup();
      const { props } = renderSidebar();
      openContextMenu('First chat');
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      await user.keyboard('{Enter}');
      expect(props.onRenameConversation).not.toHaveBeenCalled();

      openContextMenu('First chat');
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
      const input = screen.getByRole('textbox', { name: 'Rename conversation' });
      await user.clear(input);
      await user.keyboard('{Enter}');
      expect(props.onRenameConversation).not.toHaveBeenCalled();
    });
  });

  describe('copy link', () => {
    it('copies the conversation link through navigator.clipboard and reports it', async () => {
      // userEvent.setup() installs its own fake clipboard; mock AFTER it so
      // the component's copy path hits our spy.
      const user = userEvent.setup();
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
      });
      const { props } = renderSidebar();
      openContextMenu('First chat');
      await user.click(screen.getByRole('menuitem', { name: 'Copy link' }));

      const writeText = vi.mocked(navigator.clipboard.writeText);
      expect(writeText).toHaveBeenCalledOnce();
      expect(writeText).toHaveBeenCalledWith('agenthub://threads/c1');
      expect(props.onCopyConversationLink).toHaveBeenCalledOnce();
      expect(props.onCopyConversationLink).toHaveBeenCalledWith('c1', 'agenthub://threads/c1');
    });

    it('falls back gracefully when the clipboard API is unavailable', async () => {
      const user = userEvent.setup();
      // Remove the fake clipboard user-event installed — the component must
      // degrade silently (textarea fallback) and still report the link.
      delete (navigator as { clipboard?: unknown }).clipboard;
      const { props } = renderSidebar();
      openContextMenu('First chat');
      await act(async () => {
        await user.click(screen.getByRole('menuitem', { name: 'Copy link' }));
      });
      expect(props.onCopyConversationLink).toHaveBeenCalledOnce();
      expect(props.onCopyConversationLink).toHaveBeenCalledWith('c1', 'agenthub://threads/c1');
    });
  });

  describe('delete confirmation', () => {
    it('requires a second confirm before deleting the conversation', async () => {
      const user = userEvent.setup();
      const { props } = renderSidebar();
      openContextMenu('First chat');
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Delete conversation "First chat"? This cannot be undone.')).toBeInTheDocument();
      expect(props.onDeleteConversation).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(props.onDeleteConversation).toHaveBeenCalledOnce();
      expect(props.onDeleteConversation).toHaveBeenCalledWith('c1');
    });

    it('cancels the delete dialog without calling the callback', async () => {
      const user = userEvent.setup();
      const { props } = renderSidebar();
      openContextMenu('First chat');
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(props.onDeleteConversation).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('ConversationSidebar interaction structure (#1715)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function conversationRows(): HTMLElement[] {
    const listbox = screen.getByRole('listbox');
    return within(listbox).getAllByRole('option');
  }

  it('keeps row selection and row actions as sibling surfaces (no button button)', () => {
    renderSidebar({ onPinConversation: vi.fn(), onArchiveConversation: vi.fn() });
    const rows = conversationRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.querySelector('button button')).toBeNull();
    }
  });

  it('pin action does not trigger row selection', async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar({
      onPinConversation: vi.fn(),
      onSelectConversation: vi.fn(),
    });
    const firstRow = conversationRows()[0]!;
    await user.click(within(firstRow).getByRole('button', { name: '置顶' }));
    expect(props.onPinConversation).toHaveBeenCalledWith('c1', true);
    expect(props.onSelectConversation).not.toHaveBeenCalled();
  });

  it('archive action does not trigger row selection', async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar({
      onArchiveConversation: vi.fn(),
      onSelectConversation: vi.fn(),
    });
    const firstRow = conversationRows()[0]!;
    await user.click(within(firstRow).getByRole('button', { name: 'Archive' }));
    // #1821: archive confirms in a Modal (no more native window.confirm).
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
    expect(props.onArchiveConversation).toHaveBeenCalledWith('c1', true);
    expect(props.onSelectConversation).not.toHaveBeenCalled();
  });

  it('clicking a row still selects the conversation', async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar({ onSelectConversation: vi.fn() });
    await user.click(screen.getByText('Second chat'));
    expect(props.onSelectConversation).toHaveBeenCalledOnce();
    expect(props.onSelectConversation).toHaveBeenCalledWith('c2');
  });

  it('preserves roving tabindex keyboard navigation across rows', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const rows = conversationRows();
    const firstButton = within(rows[0]!).getByRole('button');
    const secondButton = within(rows[1]!).getByRole('button');
    expect(firstButton).toHaveAttribute('tabindex', '0');
    expect(secondButton).toHaveAttribute('tabindex', '-1');
    firstButton.focus();
    await user.keyboard('{ArrowDown}');
    expect(firstButton).toHaveAttribute('tabindex', '-1');
    expect(secondButton).toHaveAttribute('tabindex', '0');
  });
});

describe('ConversationSidebar new-conversation entry (#1819)', () => {
  it('renders the sidebar header button when onStartNewConversation is wired', async () => {
    const user = userEvent.setup();
    const onStartNewConversation = vi.fn();
    renderSidebar({ onStartNewConversation });
    const button = screen.getByRole('button', { name: 'New conversation' });
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(onStartNewConversation).toHaveBeenCalledOnce();
  });

  it('does not render the button when the callback is absent', () => {
    renderSidebar({ onStartNewConversation: undefined });
    expect(screen.queryByRole('button', { name: 'New conversation' })).not.toBeInTheDocument();
  });

  it('renders the empty-state CTA (no conversations) and fires the callback', async () => {
    const user = userEvent.setup();
    const onStartNewConversation = vi.fn();
    renderSidebar({
      conversations: [],
      onStartNewConversation,
    });
    expect(screen.getByText('No conversations')).toBeInTheDocument();
    // Scope to the list so the header icon button (same accessible name)
    // is not matched — the CTA lives inside the empty row.
    const listbox = screen.getByRole('listbox');
    const cta = within(listbox).getByRole('button', { name: 'New conversation' });
    await user.click(cta);
    expect(onStartNewConversation).toHaveBeenCalledOnce();
  });

  it('keeps the search empty-state clean (only clear-search, no CTA) during a query hit', () => {
    renderSidebar({
      conversations: [],
      onStartNewConversation: vi.fn(),
    });
    // The search box is present; typing a query switches to the search
    // empty state (clear-search action only — no new-conversation CTA).
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matching results')).toBeInTheDocument();
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('button')).toHaveLength(1);
    expect(within(listbox).getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });
});


/* ── F1 live status dots ────────────────────────────────────────────── */
describe('ConversationSidebar live status dots (F1)', () => {
  it('renders a dot per mapped conversation with the status semantics, none elsewhere', () => {
    renderSidebar({
      conversations: [
        { id: 'c1', title: 'Running chat', kind: 'direct' },
        { id: 'c2', title: 'Waiting chat', kind: 'direct' },
        { id: 'c3', title: 'Quiet chat', kind: 'direct' },
      ],
      liveStatusByConversation: { c1: 'running', c2: 'awaiting-approval' },
    });

    const runningRow = screen.getByText('Running chat').closest('[data-agent-profile]')!;
    const runningDot = within(runningRow).getByLabelText('Running');
    expect(runningDot).toHaveAttribute('data-live-status', 'running');

    const waitingRow = screen.getByText('Waiting chat').closest('[data-agent-profile]')!;
    const waitingDot = within(waitingRow).getByLabelText('Awaiting approval');
    expect(waitingDot).toHaveAttribute('data-live-status', 'awaiting-approval');

    const quietRow = screen.getByText('Quiet chat').closest('[data-agent-profile]')!;
    expect(quietRow.querySelector('[data-live-status]')).toBeNull();
  });

  it('renders no dots at all when the shell provides no run inventory', () => {
    const { container } = renderSidebar();
    expect(container.querySelector('[data-live-status]')).toBeNull();
  });
});

/* ── Task queue group + task deep links (#1963) ─────────────────────── */

function makeQueueTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'sqlite-plan',
    title: 'B0 SQLite 迁移方案',
    project: '前端重构任务',
    assignee: 'Builder',
    startTime: '今天 14:49',
    dueDate: '明天 18:00',
    creator: 'demo-user',
    status: '进行中',
    ...overrides,
  };
}

describe('ConversationSidebar task queue group (#1963)', () => {
  beforeEach(() => {
    resetWorkbenchTaskDeepLinksForTest();
  });

  afterEach(() => {
    resetWorkbenchTaskDeepLinksForTest();
  });

  it('hides the task queue group when there are no active tasks', () => {
    renderSidebar();
    expect(screen.queryByText('Task queue')).not.toBeInTheDocument();
  });

  it('renders the group expanded by default when active tasks exist', () => {
    publishWorkbenchTaskQueue([
      makeQueueTask(),
      makeQueueTask({ id: 'embedded-docs', title: '云文档内嵌子页对齐', status: '待评审' }),
    ]);
    renderSidebar();

    const header = screen.getByRole('button', { name: /Task queue/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('B0 SQLite 迁移方案')).toBeInTheDocument();
    expect(screen.getByText('云文档内嵌子页对齐')).toBeInTheDocument();
  });

  it('collapses and re-expands the group through the header toggle', () => {
    publishWorkbenchTaskQueue([makeQueueTask()]);
    renderSidebar();

    const header = screen.getByRole('button', { name: /Task queue/ });
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('B0 SQLite 迁移方案')).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('B0 SQLite 迁移方案')).toBeInTheDocument();
  });

  it('queues a conversation→task deep link when a queue entry is clicked', () => {
    publishWorkbenchTaskQueue([makeQueueTask()]);
    renderSidebar();

    fireEvent.click(screen.getByText('B0 SQLite 迁移方案').closest('button')!);

    const { pending } = getWorkbenchTaskDeepLinkSnapshot();
    expect(pending?.type).toBe('open');
    if (pending?.type !== 'open') return;
    expect(pending.link.direction).toBe('conversation-to-task');
    expect(pending.link.taskId).toBe('sqlite-plan');
  });

  it('shows a back chip on the conversation a task deep link opened', () => {
    // Simulate the shell applying a task→conversation deep link onto c1.
    openConversationForTask(makeQueueTask({ conversationId: 'c1' }));
    consumeWorkbenchTaskDeepLinkIntent();
    renderSidebar();

    const chip = screen.getByRole('button', { name: /Back to task/ });
    expect(within(chip).getByText('B0 SQLite 迁移方案')).toBeInTheDocument();

    fireEvent.click(chip);
    const { pending } = getWorkbenchTaskDeepLinkSnapshot();
    expect(pending?.type).toBe('back');
    if (pending?.type !== 'back') return;
    expect(pending.link.direction).toBe('task-to-conversation');
  });

  it('hides the back chip once the user moves to another conversation', () => {
    openConversationForTask(makeQueueTask({ conversationId: 'c1' }));
    consumeWorkbenchTaskDeepLinkIntent();
    renderSidebar({ activeConversationId: 'c2' });
    expect(screen.queryByRole('button', { name: /Back to task/ })).not.toBeInTheDocument();
  });

  it('hides the back chip after the back trip has been applied', () => {
    openConversationForTask(makeQueueTask({ conversationId: 'c1' }));
    consumeWorkbenchTaskDeepLinkIntent();
    backFromTaskDeepLink();
    consumeWorkbenchTaskDeepLinkIntent();
    renderSidebar();
    expect(screen.queryByRole('button', { name: /Back to task/ })).not.toBeInTheDocument();
  });
});
