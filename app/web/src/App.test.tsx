import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import App from '@/App';

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: () => <span data-testid="icon-claude-code" />,
  Codex: () => <span data-testid="icon-codex" />,
  ModelIcon: () => <span data-testid="icon-model" />,
  OpenCode: () => <span data-testid="icon-opencode" />,
}));

vi.mock('@/views/viewRegistry', () => ({
  Slot: ({ name }: { name: string }) => <div data-testid={`slot-${name}`}>{name}</div>,
}));

vi.mock('@/components/SettingsPage', () => ({
  default: () => <div data-testid="settings-page">Settings route content</div>,
}));

vi.mock('@/components/AuthPage', () => ({
  default: () => <div data-testid="auth-page">Auth route content</div>,
}));

function visibleText(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('style, script').forEach((node) => node.remove());
  return clone.textContent ?? '';
}

function renderShell() {
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

  it('renders the workspace shell without raw shell keys or fake live claims', () => {
    const { container } = renderShell();
    const text = visibleText(container);

    expect(screen.getByText('AgentHub')).toBeInTheDocument();
    expect(screen.getByTestId('slot-agent-list')).toBeInTheDocument();
    expect(screen.getByTestId('slot-thread-panel')).toBeInTheDocument();
    expect(screen.getByTestId('slot-main-view')).toBeInTheDocument();
    expect(screen.getByTestId('slot-prompt-input')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open run detail' }));
    expect(screen.getByTestId('slot-run-detail')).toBeInTheDocument();
    expect(text).toContain('Hub path idle');
    expect(text).toContain('Sign in for realtime');
    expect(text).not.toMatch(/shell\.(?:brand|toolbar|status|sidebar|statusPanel|workspace|page|source)/);
    expect(text).not.toMatch(/synced|marketplace connected|session active/i);
  });

  it('switches between workspace, messages, and settings surfaces', () => {
    renderShell();

    fireEvent.click(screen.getByRole('tab', { name: 'Messages' }));
    expect(screen.getByTestId('slot-im-view')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }));
    expect(screen.getByTestId('slot-main-view')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
  });

  it('keeps explicit source state labels visible in the shell chrome', () => {
    renderShell();

    expect(screen.getByText('Hub path idle')).toBeInTheDocument();
    expect(screen.getByText('Sign in for realtime')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
