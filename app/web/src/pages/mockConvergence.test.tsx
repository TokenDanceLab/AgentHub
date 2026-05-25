import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import AgentSquarePageInteractive from './agent-square/AgentSquarePage';
import PrivateChatsPageInteractive from './private-chats/PrivateChatsPage';
import ProjectPageInteractive from './projects/ProjectPage';

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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('labels Project fallback data as demo/mock when Edge has no snapshot', () => {
    render(<ProjectPageInteractive />);

    expect(screen.getAllByText('Demo / mock fallback').length).toBeGreaterThan(0);
    expect(screen.queryByText('source.mockFallback')).not.toBeInTheDocument();
  });

  it('locks Private Chats when there is no Web Hub session', () => {
    render(<PrivateChatsPageInteractive />);

    expect(screen.getAllByText('Hub session required').length).toBeGreaterThan(0);
    expect(screen.getByText(/will not show mock conversations/i)).toBeInTheDocument();
    expect(screen.queryByText('Local mock')).not.toBeInTheDocument();
  });

  it('labels Agent Square catalog/mock fallback and does not render raw i18n keys', () => {
    const { container } = render(<AgentSquarePageInteractive />);
    const text = visibleText(container);

    expect(screen.getAllByText('Catalog/mock fallback').length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\b(?:agentSquare|privateChats|groupWorkspace|project|workbench)\./);
    expect(text).not.toContain('source.catalogMock');
    expect(text).not.toContain('brand.subtitle');
    expect(text).not.toContain('sidebar.catalog');
    expect(text).not.toContain('header.description');
    expect(text).not.toContain('common:action.dismiss');
  });
});
