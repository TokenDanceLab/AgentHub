import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KeyboardSection from './KeyboardSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { action?: string }) => (
      options?.action ? `${key} ${options.action}` : key
    ),
  }),
}));

function expectNoUndefinedClasses(container: HTMLElement) {
  const nodesWithUndefinedClass = Array.from(container.querySelectorAll('[class]'))
    .filter((node) => /\bundefined\b/.test(node.className));

  expect(nodesWithUndefinedClass).toHaveLength(0);
}

describe('KeyboardSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('places default shortcut actions in the panel header', () => {
    const { container } = render(<KeyboardSection />);

    const customize = screen.getByRole('button', { name: 'settings.keyboardCustomize' });
    const header = customize.closest('[class*="panelHeader"]');
    const table = container.querySelector('[class*="shortcutTable"]');

    expect(header).toBeInTheDocument();
    expect(table).toBeInTheDocument();
    expect(header!.compareDocumentPosition(table!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(table!.querySelector('button')).not.toBeInTheDocument();
  });

  it('reserves hidden panel header action space while editing', () => {
    localStorage.setItem('agenthub-custom-keybindings', JSON.stringify({ 'new-thread': ['Ctrl', 'N'] }));
    const { container } = render(<KeyboardSection />);

    const headerActions = container.querySelector('[class*="panelHeaderActions"]');

    expect(headerActions).toBeInTheDocument();
    expect(headerActions!.querySelectorAll('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'settings.keyboardCustomize' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.keyboardReset' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'settings.keyboardCustomize' }));

    const placeholder = headerActions!.querySelector('[class*="panelHeaderActionPlaceholder"]');
    const placeholderButtons = placeholder!.querySelectorAll('button');

    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(placeholderButtons).toHaveLength(2);
    expect(placeholderButtons[0]).toBeDisabled();
    expect(placeholderButtons[0]).toHaveAttribute('tabindex', '-1');
    expect(placeholderButtons[1]).toBeDisabled();
    expect(placeholderButtons[1]).toHaveAttribute('tabindex', '-1');
    expectNoUndefinedClasses(container);
  });

  it('keeps the custom shortcut editor in a styled table layout', () => {
    const { container } = render(<KeyboardSection />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.keyboardCustomize' }));

    expect(screen.getByText('shortcut.group.conversation')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^settings\.keyboardEditBinding/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'settings.keyboardSave' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'settings.keyboardCancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.keyboardReset' })).toBeInTheDocument();
    expectNoUndefinedClasses(container);
  });

  it('renders capture controls and shortcut conflict feedback', () => {
    const { container } = render(<KeyboardSection />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.keyboardCustomize' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^settings\.keyboardEditBinding/ })[0]);

    expect(screen.getByText('settings.keyboardCapturePrompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.keyboardConfirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'settings.keyboardCancelCapture' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: '/' });

    expect(screen.getAllByText('/').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.keyboardConflict shortcut.slashCommands')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.keyboardConfirm' })).toBeDisabled();
    expectNoUndefinedClasses(container);
  });
});
