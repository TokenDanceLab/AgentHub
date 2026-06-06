import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KeyboardSection from './KeyboardSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('KeyboardSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('places default shortcut actions in the panel header', () => {
    const { container } = render(<KeyboardSection />);

    const customize = screen.getByRole('button', { name: 'settings.keyboardCustomize' });
    const header = customize.closest('[class*="panelHeader"]');
    const actions = customize.closest('[class*="shortcutActions"]');
    const table = container.querySelector('[class*="shortcutTable"]');

    expect(header).toBeInTheDocument();
    expect(actions).toBeInTheDocument();
    expect(table).toBeInTheDocument();
    expect(header!.compareDocumentPosition(table!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('renders edit controls without undefined classes after customizing', () => {
    const { container } = render(<KeyboardSection />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.keyboardCustomize' }));

    expect(screen.getByRole('button', { name: 'settings.keyboardSave' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.keyboardCancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.keyboardReset' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'settings.keyboardEditBinding' }).length).toBeGreaterThan(0);
    expect(container.querySelector('[class*="shortcutEditFooter"]')).toBeInTheDocument();

    const undefinedClass = Array.from(container.querySelectorAll('[class]')).find((element) =>
      element.getAttribute('class')?.includes('undefined'),
    );
    expect(undefinedClass).toBeUndefined();
  });

  it('renders capture actions after choosing a shortcut to edit', () => {
    render(<KeyboardSection />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.keyboardCustomize' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.keyboardEditBinding' })[0]!);
    fireEvent.keyDown(window, { key: 'x' });

    expect(screen.getByText('X')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.keyboardConfirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.keyboardCancelCapture' })).toBeInTheDocument();
  });

  it('defines every shortcut edit CSS module class used by the component', () => {
    const css = readFileSync(
      'src/components/settings/primitives/primitives.module.css',
      'utf8',
    );

    [
      'shortcutActions',
      'shortcutEditTable',
      'shortcutEditGroup',
      'shortcutEditGroupTitle',
      'shortcutEditRow',
      'shortcutEditRowCapturing',
      'shortcutEditInfo',
      'shortcutEditLabel',
      'shortcutEditDetail',
      'shortcutEditBinding',
      'shortcutCaptureArea',
      'shortcutCaptureKeys',
      'shortcutCaptureHint',
      'shortcutConflict',
      'shortcutDisplayKeys',
      'shortcutEditActions',
      'shortcutEditBtn',
      'shortcutConfirmBtn',
      'shortcutCancelBtn',
      'shortcutEditFooter',
      'shortcutEditFooterActions',
    ].forEach((className) => {
      expect(css).toContain(`.${className}`);
    });
  });
});
