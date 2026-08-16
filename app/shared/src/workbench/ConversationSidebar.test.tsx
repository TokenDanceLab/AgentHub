import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { WorkbenchConversation } from '../platform';
import { ConversationSidebar } from './ConversationSidebar';

/* ──────────────────────────────────────────────────────────────────────
   ConversationSidebar actions tests (#1508): rename / copy link / delete.
   jsdom has no layout engine, so virtua is mocked with a passthrough.
   ────────────────────────────────────────────────────────────────────── */

// These assertions use the en chatview literals; opt into the en bundle of
// the shared test i18next instance (Issue #1717).
import { useTestI18nLanguage } from '../testing/i18n';

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
