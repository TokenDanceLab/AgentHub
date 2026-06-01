import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { router } from '@/router';
import App from '@/App';

vi.mock('@/pages/Workbench', () => ({
  default: () => <div data-testid="page-workbench">Workbench route content</div>,
}));

vi.mock('@/pages/AgentSquare', () => ({
  default: () => <div data-testid="page-agent-square">Agent Square route content</div>,
}));

vi.mock('@/pages/PrivateChats', () => ({
  default: () => <div data-testid="page-private-chats">Private Chats route content</div>,
}));

vi.mock('@/pages/GroupWorkspace', () => ({
  default: () => <div data-testid="page-group-workspace">Group Workspace route content</div>,
}));

vi.mock('@/pages/Project', () => ({
  default: () => <div data-testid="page-project">Project route content</div>,
}));

function visibleText(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('style, script').forEach((node) => node.remove());
  return clone.textContent ?? '';
}

async function renderShell(path = '/') {
  await router.navigate(path);
  return render(<App />);
}

describe('Web shell', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: '',
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders translated shell copy without raw shell keys or fake live claims', async () => {
    const { container } = await renderShell();

    expect(await screen.findByTestId('page-workbench')).toBeInTheDocument();
    const text = visibleText(container);

    expect(text).toContain('Workbench Edge unavailable');
    expect(text).toContain('Workbench Edge unavailable/error');
    expect(text).not.toMatch(/shell\.(?:brand|toolbar|status|sidebar|statusPanel|workspace|page|source)/);
    expect(text).not.toMatch(/synced|live|success|marketplace connected|session active/i);
  });

  it('navigates the shell to all five routed pages', async () => {
    await renderShell();

    const sidebar = screen.getByLabelText('Workspace navigation');
    const nav = within(sidebar);

    expect(await screen.findByTestId('page-workbench')).toBeInTheDocument();

    fireEvent.click(nav.getByRole('button', { name: /Agent Square/i }));
    expect(await screen.findByTestId('page-agent-square')).toBeInTheDocument();

    fireEvent.click(nav.getByRole('button', { name: /Private Chats/i }));
    expect(await screen.findByTestId('page-private-chats')).toBeInTheDocument();

    fireEvent.click(nav.getByRole('button', { name: /Group Workspace/i }));
    expect(await screen.findByTestId('page-group-workspace')).toBeInTheDocument();

    fireEvent.click(nav.getByRole('button', { name: /Project Preview/i }));
    expect(await screen.findByTestId('page-project')).toBeInTheDocument();
  });

  it('shows explicit source badges for each shell source state', async () => {
    await renderShell();

    const sidebar = screen.getByLabelText('Workspace navigation');
    const nav = within(sidebar);
    const statusPanel = () => within(screen.getByLabelText('Status and source panel'));

    expect(statusPanel().getByText('Edge unavailable/error')).toBeInTheDocument();
    expect(statusPanel().getByText(/no verified Local Edge workbench source/i)).toBeInTheDocument();

    fireEvent.click(nav.getByRole('button', { name: /Agent Square/i }));
    expect(await screen.findByTestId('page-agent-square')).toBeInTheDocument();
    expect(statusPanel().getByText('Catalog fallback')).toBeInTheDocument();
    expect(statusPanel().getByText(/Hub custom-agent data is unavailable/i)).toBeInTheDocument();

    fireEvent.click(nav.getByRole('button', { name: /Private Chats/i }));
    expect(await screen.findByTestId('page-private-chats')).toBeInTheDocument();
    expect(statusPanel().getByText('Hub session required')).toBeInTheDocument();
    expect(statusPanel().getByText(/does not claim an active session/i)).toBeInTheDocument();

    fireEvent.click(nav.getByRole('button', { name: /Group Workspace/i }));
    expect(await screen.findByTestId('page-group-workspace')).toBeInTheDocument();
    expect(statusPanel().getByText('Demo fallback')).toBeInTheDocument();
    expect(statusPanel().getByText(/Group\/Project demo fallback/i)).toBeInTheDocument();

    fireEvent.click(nav.getByRole('button', { name: /Project Preview/i }));
    expect(await screen.findByTestId('page-project')).toBeInTheDocument();
    expect(statusPanel().getByText('Demo fallback')).toBeInTheDocument();
  });
});
