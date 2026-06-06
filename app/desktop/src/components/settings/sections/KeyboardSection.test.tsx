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
