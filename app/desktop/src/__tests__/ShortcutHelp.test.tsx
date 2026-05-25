import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ShortcutHelp from '@/components/ShortcutHelp';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ShortcutHelp', () => {
  it('renders shell navigation shortcuts', () => {
    render(<ShortcutHelp open onClose={vi.fn()} />);

    expect(screen.getByText('shortcut.toggleSidebar')).toBeInTheDocument();
    expect(screen.getByText('shortcut.toggleRunPanel')).toBeInTheDocument();
    expect(screen.getAllByText('⌘/Ctrl')).toHaveLength(2);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ShortcutHelp open onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
