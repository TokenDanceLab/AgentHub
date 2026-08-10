import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { getFocusableElements, useFocusTrap } from './focusTrap';

/** Minimal dialog using useFocusTrap + Escape-to-close, mirroring Modal.tsx. */
function TrapDialog() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {open && (
        <div ref={dialogRef}>
          <input aria-label="First field" />
          <button type="button">Middle button</button>
          <button type="button">Last button</button>
        </div>
      )}
    </>
  );
}

/** Two stacked dialog layers to verify traps stay scoped per layer. */
function NestedDialogs() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const childRef = useRef<HTMLDivElement>(null);
  useFocusTrap(parentRef, parentOpen);
  useFocusTrap(childRef, childOpen);

  return (
    <>
      <button type="button" onClick={() => setParentOpen(true)}>
        Open parent
      </button>
      {parentOpen && (
        <div ref={parentRef}>
          <button type="button" onClick={() => setChildOpen(true)}>
            Open child
          </button>
          <button type="button" onClick={() => setParentOpen(false)}>
            Close parent
          </button>
          {childOpen && (
            <div ref={childRef}>
              <input aria-label="Child field" />
              <button type="button" onClick={() => setChildOpen(false)}>
                Close child
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

describe('focusTrap', () => {
  it('focuses the first focusable element on activation', () => {
    render(<TrapDialog />);
    fireEvent.click(screen.getByText('Open dialog'));
    expect(document.activeElement).toBe(screen.getByLabelText('First field'));
  });

  it('traps Tab: wraps from the last element back to the first', () => {
    render(<TrapDialog />);
    fireEvent.click(screen.getByText('Open dialog'));
    const last = screen.getByText('Last button');
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('First field'));
  });

  it('traps Shift+Tab: wraps from the first element to the last', () => {
    render(<TrapDialog />);
    fireEvent.click(screen.getByText('Open dialog'));
    const first = screen.getByLabelText('First field');
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Last button'));
  });

  it('returns focus to the trigger on Escape close', () => {
    render(<TrapDialog />);
    const trigger = screen.getByText('Open dialog');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByLabelText('First field'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByLabelText('First field')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps focus inside the dialog after Tab beyond the last element', () => {
    render(<TrapDialog />);
    fireEvent.click(screen.getByText('Open dialog'));
    const last = screen.getByText('Last button');
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    // Focus must stay inside the dialog (wrapped to first), not the body.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByLabelText('First field'));
  });

  describe('getFocusableElements', () => {
    it('includes position:fixed elements (visible despite offsetParent null)', () => {
      const { container } = render(
        <div data-testid="host">
          <div style={{ position: 'fixed' }}>
            <button type="button">fixed button</button>
          </div>
          <button type="button">plain button</button>
        </div>,
      );
      const labels = getFocusableElements(container).map((el) => el.textContent);
      expect(labels).toEqual(['fixed button', 'plain button']);
    });

    it('excludes display:none elements', () => {
      const { container } = render(
        <div data-testid="host">
          <div style={{ display: 'none' }}>
            <button type="button">hidden button</button>
          </div>
          <button type="button">visible button</button>
        </div>,
      );
      const labels = getFocusableElements(container).map((el) => el.textContent);
      expect(labels).toEqual(['visible button']);
    });

    it('excludes children of a display:none ancestor', () => {
      const { container } = render(
        <div data-testid="host">
          <div style={{ display: 'none' }}>
            <div>
              <button type="button">deep hidden button</button>
            </div>
          </div>
          <button type="button">visible button</button>
        </div>,
      );
      const labels = getFocusableElements(container).map((el) => el.textContent);
      expect(labels).toEqual(['visible button']);
    });
  });

  describe('nested layers', () => {
    it('keeps each trap scoped to its own layer', () => {
      render(<NestedDialogs />);
      const openParent = screen.getByText('Open parent');
      openParent.focus();
      fireEvent.click(openParent);
      expect(document.activeElement).toBe(screen.getByText('Open child'));

      // Open the child dialog: focus moves into the child layer.
      fireEvent.click(screen.getByText('Open child'));
      expect(document.activeElement).toBe(screen.getByLabelText('Child field'));

      // Tab from the child's last element wraps within the child only.
      const closeChild = screen.getByText('Close child');
      closeChild.focus();
      fireEvent.keyDown(closeChild, { key: 'Tab' });
      expect(document.activeElement).toBe(screen.getByLabelText('Child field'));

      // Closing the child returns focus to its trigger inside the parent.
      fireEvent.click(closeChild);
      expect(document.activeElement).toBe(screen.getByText('Open child'));

      // Closing the parent returns focus to the root trigger.
      fireEvent.click(screen.getByText('Close parent'));
      expect(document.activeElement).toBe(openParent);
    });
  });
});
