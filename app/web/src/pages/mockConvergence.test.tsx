import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import AgentSquarePageInteractive from './AgentSquare';
import GroupWorkspacePageInteractive from './GroupWorkspace';
import PrivateChatsPageInteractive from './PrivateChats';
import ProjectPageInteractive from './Project';

const emptyWorkbenchState = {
  projects: [],
  threads: [],
  runners: [],
  runs: [],
  threadItems: [],
  approvals: [],
  artifacts: [],
  previews: [],
  runLogs: {},
  connection: { status: 'error', error: 'Edge unavailable in test' },
  lastSeq: 0,
};

vi.mock('../hooks/useWorkbenchProjection', () => ({
  useWorkbenchProjection: () => emptyWorkbenchState,
}));

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

  it('locks Project when there is no Web Hub session', () => {
    render(<ProjectPageInteractive />);

    expect(screen.getAllByText('Hub session required').length).toBeGreaterThan(0);
    expect(screen.getByText('Please sign in to Hub to view project data and milestones.')).toBeInTheDocument();
    expect(screen.queryByText('Demo / mock fallback')).not.toBeInTheDocument();
    expect(screen.queryByText('Demo active tasks')).not.toBeInTheDocument();
  });

  it('locks Group Workspace when there is no Web Hub session', () => {
    render(<GroupWorkspacePageInteractive />);

    expect(screen.getAllByText('Local workspace ready').length).toBeGreaterThan(0);
    expect(screen.getByText('Please sign in to Hub to view group workspace data.')).toBeInTheDocument();
    expect(screen.queryByText('Demo / mock fallback')).not.toBeInTheDocument();
    expect(screen.queryByText('Demo online members')).not.toBeInTheDocument();
  });

  it('locks Private Chats when there is no Web Hub session', () => {
    render(<PrivateChatsPageInteractive />);

    expect(screen.getAllByText('Hub session required').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/will not show mock conversations/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Local mock')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads Private Chats from Hub sessions and recent messages when a Web Hub token exists', async () => {
    window.sessionStorage.setItem('agenthub_web_hub_token', 'token-1');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        code: 'OK',
        data: [
          { session_id: 's-private', type: 'private', name: 'Xavier', unread_count: 2, updated_at: '2026-05-25T09:12:00Z' },
          { session_id: 's-group', type: 'group', name: 'Group room', unread_count: 5 },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
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
      }));

    render(<PrivateChatsPageInteractive />);

    expect((await screen.findAllByText('Xavier')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hub private handoff is ready').length).toBeGreaterThan(0);
    expect(screen.queryByText('Group room')).not.toBeInTheDocument();
    expect(screen.queryByText('Active conversation')).not.toBeInTheDocument();
  });

  it('shows Private Chats error state instead of mock conversations when Hub fails', async () => {
    window.sessionStorage.setItem('agenthub_web_hub_token', 'token-1');
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'HUB_DOWN', message: 'Hub unavailable' }, { status: 503 }));

    render(<PrivateChatsPageInteractive />);

    expect(await screen.findByText('Hub unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Mock conversations remain hidden/i)).toBeInTheDocument();
    expect(screen.queryByText('Active conversation')).not.toBeInTheDocument();
  });

  it('labels Agent Square catalog fallback and does not render raw i18n keys', () => {
    const { container } = render(<AgentSquarePageInteractive />);
    const text = visibleText(container);

    expect(screen.getAllByText('Catalog fallback').length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\b(?:agentSquare|privateChats|groupWorkspace|project|workbench)\./);
    expect(text).not.toContain('source.catalogMock');
    expect(text).not.toContain('Catalog/mock fallback');
    expect(text).not.toContain('brand.subtitle');
    expect(text).not.toContain('sidebar.catalog');
    expect(text).not.toContain('header.description');
    expect(text).not.toContain('common:action.dismiss');
  });

  it('keeps Agent Square on labeled catalog fallback without fake sync wording when Hub is unavailable', async () => {
    window.sessionStorage.setItem('agenthub_web_hub_token', 'token-1');
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'HUB_DOWN', message: 'Hub unavailable' }, { status: 503 }));

    const { container } = render(<AgentSquarePageInteractive />);

    await waitFor(() => {
      expect(visibleText(container)).toContain('Hub custom agents are unavailable');
    });
    expect(visibleText(container)).not.toMatch(/sync succeeded|pretending/i);
  });
});
