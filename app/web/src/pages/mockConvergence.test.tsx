import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import AgentSquarePageInteractive from './AgentSquare';
import GroupWorkspacePageInteractive from './GroupWorkspace';
import PrivateChatsPageInteractive from './PrivateChats';
import ProjectPageInteractive from './Project';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
    ...init,
  });
}

function visibleText(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('style, script').forEach((node) => node.remove());
  return clone.textContent ?? '';
}

describe('Web mock convergence states', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.localStorage.clear();
    window.sessionStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows locked state in Project when there is no Hub session', () => {
    render(<ProjectPageInteractive />);

    expect(screen.getByText('AgentHub Desktop')).toBeInTheDocument();
    expect(screen.getByText('Project detail')).toBeInTheDocument();
    expect(screen.getByText('Hub session required')).toBeInTheDocument();
    expect(
      screen.getByText('Please sign in to Hub to view project data and milestones.'),
    ).toBeInTheDocument();
  });

  it('shows ready state in Group Workspace when there is no Hub session', () => {
    render(<GroupWorkspacePageInteractive />);

    expect(screen.getByText('Shared operations cockpit')).toBeInTheDocument();
    expect(screen.getByText('Group Workspace')).toBeInTheDocument();
    expect(screen.getByText('Local workspace ready')).toBeInTheDocument();
    expect(
      screen.getByText('Please sign in to Hub to view group workspace data.'),
    ).toBeInTheDocument();
  });

  it('shows locked state in Private Chats when there is no Hub session', () => {
    render(<PrivateChatsPageInteractive />);

    expect(screen.getAllByText('Hub session required').length).toBeGreaterThan(0);
    expect(screen.getByText('Login required')).toBeInTheDocument();
    expect(screen.getAllByText(/will not show mock conversations/i).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads private sessions and shows chat list in Private Chats when a Hub token is present', async () => {
    window.sessionStorage.setItem('agenthub_web_hub_token', 'token-1');
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          code: 'OK',
          data: [
            {
              session_id: 's-private',
              type: 'private',
              name: 'Xavier',
              unread_count: 2,
              updated_at: '2026-05-25T09:12:00Z',
            },
            {
              session_id: 's-group',
              type: 'group',
              name: 'Group room',
              unread_count: 5,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 'OK',
          data: [
            {
              id: 'm1',
              session_id: 's-private',
              seq_id: 1,
              sender_type: 'user',
              sender_id: 'u1',
              content_type: 'text',
              content: '{"text":"Hub private handoff is ready"}',
              created_at: '2026-05-25T09:13:00Z',
            },
          ],
        }),
      );

    render(<PrivateChatsPageInteractive />);

    expect(await screen.findByText('Xavier')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('Group room')).not.toBeInTheDocument();
  });

  it('shows empty chat list in Private Chats when Hub returns an error', async () => {
    window.sessionStorage.setItem('agenthub_web_hub_token', 'token-1');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'HUB_DOWN', message: 'Hub unavailable' }, { status: 503 }),
    );

    render(<PrivateChatsPageInteractive />);

    expect(await screen.findByText('No private chats')).toBeInTheDocument();
    expect(screen.queryByText('Group room')).not.toBeInTheDocument();
    expect(screen.queryByText('Active conversation')).not.toBeInTheDocument();
  });

  it('renders Agent Square with catalog fallback label and mock agents, without raw i18n keys', async () => {
    const { container } = render(<AgentSquarePageInteractive />);

    expect(screen.getByText('Catalog fallback')).toBeInTheDocument();
    expect(
      screen.getByText('No Web Hub session is available. Showing the labeled catalog fallback.'),
    ).toBeInTheDocument();

    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('GPT Builder')).toBeInTheDocument();
    expect(screen.getByText('Local Agent')).toBeInTheDocument();

    const text = visibleText(container);
    expect(text).not.toMatch(/\b(?:agentSquare|privateChats|groupWorkspace|project|workbench)\./);
    expect(text).not.toContain('source.catalogMock');
    expect(text).not.toContain('brand.subtitle');
    expect(text).not.toContain('sidebar.catalog');
    expect(text).not.toContain('header.description');
    expect(text).not.toContain('common:action.dismiss');
  });

  it('shows Hub error detail in Agent Square catalog fallback when Hub is unavailable', async () => {
    window.sessionStorage.setItem('agenthub_web_hub_token', 'token-1');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'HUB_DOWN', message: 'Hub unavailable' }, { status: 503 }),
    );

    const { container } = render(<AgentSquarePageInteractive />);

    await waitFor(() => {
      expect(visibleText(container)).toContain('Hub custom agents are unavailable');
    });
    expect(visibleText(container)).not.toMatch(/sync succeeded|pretending/i);
  });
});
