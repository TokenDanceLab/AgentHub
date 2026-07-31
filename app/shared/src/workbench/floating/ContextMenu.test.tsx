import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

// jsdom has no layout: offsetParent is null for everything, which makes the
// focus trap's visibility filter see zero focusable elements and swallow Tab
// silently. Give elements a truthy offsetParent so Tab wrapping is testable.
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get() {
    return this.parentElement;
  },
});

/** Menu without submenus — used for the pure roving/keyboard tests. */
function renderPlainMenu() {
  const onClose = vi.fn();
  const items: ContextMenuItem[] = [
    { label: '复制', onClick: vi.fn() },
    { label: '回复', onClick: vi.fn() },
    { label: '删除', onClick: vi.fn() },
  ];
  render(<ContextMenu items={items} isOpen x={120} y={120} onClose={onClose} />);
  return { onClose, items };
}

/** Menu with one chevron item whose submenu is a plain test button. */
function renderSubmenuMenu() {
  const onClose = vi.fn();
  const onSubSelect = vi.fn();
  const reactClick = vi.fn();
  const items: ContextMenuItem[] = [
    { label: '复制', onClick: vi.fn() },
    {
      label: '表情回复',
      chevron: true,
      onClick: reactClick,
      submenu: (close: () => void) => (
        <button type="button" onClick={() => { onSubSelect(); close(); }}>🔥</button>
      ),
    },
    { label: '删除', onClick: vi.fn() },
  ];
  render(<ContextMenu items={items} isOpen x={120} y={120} onClose={onClose} />);
  return { onClose, onSubSelect, reactClick };
}

describe('ContextMenu keyboard navigation (unchanged behaviors)', () => {
  it('focuses the first item on open and roves with arrows, Home and End', () => {
    renderPlainMenu();
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(document, { key: 'ArrowDown' }); // wraps
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(document, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
  });

  it('activates the focused item with Enter and closes the menu', () => {
    const onClose = vi.fn();
    const copyClick = vi.fn();
    render(
      <ContextMenu
        items={[{ label: '复制', onClick: copyClick }]}
        isOpen
        x={120}
        y={120}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(copyClick).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('wraps Tab and Shift+Tab inside the menu (focus trap)', () => {
    renderSubmenuMenu();
    const items = screen.getAllByRole('menuitem');
    fireEvent.keyDown(document, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(items[2]);
  });

  it('closes the menu on Escape', () => {
    const onClose = vi.fn();
    render(
      <ContextMenu items={[{ label: '复制', onClick: vi.fn() }]} isOpen x={10} y={10} onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps chevron items without a submenu on the click-to-activate behavior', () => {
    const onClose = vi.fn();
    const appsClick = vi.fn();
    render(
      <ContextMenu
        items={[{ label: '快捷应用', chevron: true, onClick: appsClick }]}
        isOpen
        x={120}
        y={120}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /快捷应用/ }));
    expect(appsClick).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('ContextMenu submenu (#1384)', () => {
  it('opens the submenu on hover of a chevron item and closes on hover away', () => {
    renderSubmenuMenu();
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /表情回复/ }));
    expect(screen.getByRole('button', { name: '🔥' })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /删除/ }));
    expect(screen.queryByRole('button', { name: '🔥' })).not.toBeInTheDocument();
  });

  it('opens the submenu on click without firing the item action', () => {
    const { reactClick } = renderSubmenuMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /表情回复/ }));
    expect(screen.getByRole('button', { name: '🔥' })).toBeInTheDocument();
    expect(reactClick).not.toHaveBeenCalled();
  });

  it('opens the submenu with Enter and ArrowRight, focusing its content', () => {
    renderSubmenuMenu();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    const subButton = screen.getByRole('button', { name: '🔥' });
    expect(subButton).toBeInTheDocument();
    expect(document.activeElement).toBe(subButton);

    // ArrowLeft from inside the submenu belongs to the submenu content.
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: '🔥' })).toBeInTheDocument();

    // ArrowLeft from the parent item closes the submenu and refocuses it.
    const reactItem = screen.getByRole('menuitem', { name: /表情回复/ });
    reactItem.focus();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.queryByRole('button', { name: '🔥' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(reactItem);

    // ArrowRight re-opens it.
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '🔥' })).toBeInTheDocument();
  });

  it('suspends menu arrow navigation while the submenu is open', () => {
    renderSubmenuMenu();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    const subButton = screen.getByRole('button', { name: '🔥' });
    expect(document.activeElement).toBe(subButton);

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(subButton);
    expect(screen.getByRole('button', { name: '🔥' })).toBeInTheDocument();
  });

  it('closes the whole menu when the submenu selection commits', () => {
    const { onClose, onSubSelect } = renderSubmenuMenu();
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /表情回复/ }));
    fireEvent.click(screen.getByRole('button', { name: '🔥' }));
    expect(onSubSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes the submenu first on Escape, then the menu on the second Escape', () => {
    const { onClose } = renderSubmenuMenu();
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /表情回复/ }));
    const subButton = screen.getByRole('button', { name: '🔥' });
    expect(document.activeElement).toBe(subButton);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '🔥' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /表情回复/ }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
