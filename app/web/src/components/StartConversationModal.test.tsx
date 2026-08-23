import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactMember } from '@agenthub/workbench';
// Raw-key echo is the web test instance default (#1717); these assertions use
// the real en chatview literals, so opt into the en bundle explicitly.
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { StartConversationModal } from './StartConversationModal';

/* StartConversationModal (#1819): the web "新建会话" peer picker.
   Presentational contract: list real contacts, filter by search, and relay
   the picked peer; the shell owns createPrivateSession + visible errors. */

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

const members: ContactMember[] = [
  { id: 'peer-1', name: 'Peer One', initials: 'P', org: 'TokenDance', status: '在线' },
  { id: 'peer-2', name: 'Peer Two', initials: 'T', org: 'External', status: '离线', tag: 'External' },
];

function renderModal(overrides: Partial<Parameters<typeof StartConversationModal>[0]> = {}) {
  const props = {
    open: true,
    members,
    onStart: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<StartConversationModal {...props} />);
  return props;
}

describe('StartConversationModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders every contact member as a startable row', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /Peer One/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Peer Two/ })).toBeInTheDocument();
  });

  it('filters members by the search query and clears with an empty query', async () => {
    const user = userEvent.setup();
    renderModal();
    const search = screen.getByLabelText('Search contacts…');
    await user.type(search, 'Two');
    expect(screen.queryByRole('button', { name: /Peer One/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Peer Two/ })).toBeInTheDocument();
    await user.clear(search);
    expect(screen.getByRole('button', { name: /Peer One/ })).toBeInTheDocument();
  });

  it('relays the picked member to onStart', async () => {
    const user = userEvent.setup();
    const props = renderModal();
    await user.click(screen.getByRole('button', { name: /Peer Two/ }));
    expect(props.onStart).toHaveBeenCalledWith(members[1]);
  });

  it('shows the empty state when no members exist', () => {
    renderModal({ members: [] });
    expect(screen.getByText('No contacts available')).toBeInTheDocument();
    // Only the shared Modal close button remains — no contact rows.
    expect(screen.queryByRole('button', { name: /Peer/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('surfaces a visible create error and keeps cancel reachable', () => {
    renderModal({ error: 'Failed to start a new conversation: server down' });
    expect(screen.getByRole('alert')).toHaveTextContent(/server down/);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('disables rows and close while a create call is in flight', async () => {
    const user = userEvent.setup();
    renderModal({ busy: true });
    expect(screen.getByRole('button', { name: /Peer One/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    // Escape still routes to onClose through the shared Modal.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('does not render its content while closed', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('button', { name: /Peer One/ })).not.toBeInTheDocument();
  });
});
