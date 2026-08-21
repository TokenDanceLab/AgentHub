import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmojiPicker } from './EmojiPicker';

describe('EmojiPicker', () => {
  it('renders a labeled 2×3 grid with the fixed emoji set and roving tabindex', () => {
    render(<EmojiPicker onSelect={vi.fn()} />);
    expect(screen.getByRole('grid', { name: '选择表情' })).toBeInTheDocument();
    const cells = screen.getAllByRole('gridcell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['👍', '❤️', '🎉', '👀', '🚀', '✅']);
    // Roving tabindex: only the active cell is tabbable.
    expect(cells[0]).toHaveAttribute('tabindex', '0');
    expect(cells[1]).toHaveAttribute('tabindex', '-1');
  });

  it('fires onSelect with the clicked emoji', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('gridcell', { name: '🎉' }));
    expect(onSelect).toHaveBeenCalledWith('🎉');
  });

  it('does not steal focus on mount without autoFocus', () => {
    render(<EmojiPicker onSelect={vi.fn()} />);
    expect(document.activeElement).toBe(document.body);
  });

  it('roves focus with arrow keys, Home and End (grid pattern)', () => {
    render(<EmojiPicker onSelect={vi.fn()} ariaLabel="emoji" autoFocus />);
    const grid = screen.getByRole('grid');
    const cells = screen.getAllByRole('gridcell');
    expect(document.activeElement).toBe(cells[0]);

    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells[1]);
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // row 2, column 2
    expect(document.activeElement).toBe(cells[4]);
    fireEvent.keyDown(grid, { key: 'ArrowUp' }); // back to row 1, column 2
    expect(document.activeElement).toBe(cells[1]);
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cells[0]);
    fireEvent.keyDown(grid, { key: 'ArrowLeft' }); // wraps to the end
    expect(document.activeElement).toBe(cells[5]);
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // wraps down to row 1
    expect(document.activeElement).toBe(cells[2]);
    fireEvent.keyDown(grid, { key: 'Home' });
    expect(document.activeElement).toBe(cells[0]);
    fireEvent.keyDown(grid, { key: 'End' });
    expect(document.activeElement).toBe(cells[5]);
  });

  it('selects the focused emoji with Enter via native button activation', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<EmojiPicker onSelect={onSelect} ariaLabel="emoji" autoFocus />);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('👍');
  });

  it('leaves Escape alone (submenu hosts own close handling)', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker onSelect={onSelect} ariaLabel="emoji" autoFocus />);
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Escape' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
