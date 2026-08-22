import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Select } from './Select';

const options: Array<[string, string]> = [
  ['a', 'Option A'],
  ['b', 'Option B'],
  ['c', 'Option C'],
];

describe('Select', () => {
  it('renders placeholder when no value', () => {
    render(<Select options={options} value="" onChange={() => {}} placeholder="Pick one" />);
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });

  it('renders selected label when value is set', () => {
    render(<Select options={options} value="b" onChange={() => {}} />);
    expect(screen.getByText('Option B')).toBeInTheDocument();
  });

  it('opens dropdown on trigger click', () => {
    render(<Select options={options} value="" onChange={() => {}} placeholder="Select" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('calls onChange when option clicked', () => {
    const onChange = vi.fn();
    render(<Select options={options} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Option B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('closes on Escape (unmount deferred by the exit window)', () => {
    vi.useFakeTimers();
    try {
      render(<Select options={options} value="" onChange={() => {}} placeholder="Select" />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
      // #1825: the dropdown stays mounted through its ~140ms exit animation,
      // then unmounts. Advance past the window and assert it is gone.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByRole('listbox')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('navigates with ArrowDown and selects with Enter', () => {
    const onChange = vi.fn();
    render(<Select options={[['x', 'X'], ['y', 'Y']]} value="x" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('y');
  });

  // ── Listbox a11y: aria-activedescendant + typeahead + Home/End ──

  const activeOptionLabel = (listbox: HTMLElement): string | null => {
    const activeId = listbox.getAttribute('aria-activedescendant');
    if (!activeId) return null;
    return document.getElementById(activeId)?.textContent ?? null;
  };

  it('exposes listbox with role="option" children and aria-selected', () => {
    render(<Select options={options} value="b" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    const optionEls = listbox.querySelectorAll('[role="option"]');
    expect(optionEls.length).toBe(3);
    expect(listbox.getAttribute('aria-activedescendant')).toBeTruthy();
    // Selected option reports aria-selected="true"
    const selected = Array.from(optionEls).find((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent).toBe('Option B');
  });

  it('keeps aria-activedescendant in sync with Arrow navigation', () => {
    render(<Select options={options} value="" onChange={() => {}} placeholder="Select" />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    expect(activeOptionLabel(listbox)).toBe('Option A');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(activeOptionLabel(listbox)).toBe('Option B');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(activeOptionLabel(listbox)).toBe('Option A');
  });

  it('points aria-activedescendant at the highlighted option element', () => {
    render(<Select options={options} value="" onChange={() => {}} placeholder="Select" />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    const activeId = listbox.getAttribute('aria-activedescendant');
    const activeEl = activeId ? document.getElementById(activeId) : null;
    expect(activeEl).not.toBeNull();
    expect(activeEl?.getAttribute('role')).toBe('option');
    expect(activeEl?.textContent).toBe('Option B');
  });

  it('jumps to option matching typed characters (typeahead)', () => {
    render(<Select options={options} value="" onChange={() => {}} placeholder="Select" />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'c' });
    expect(activeOptionLabel(listbox)).toBe('Option C');
  });

  it('supports consecutive-character typeahead', () => {
    render(<Select options={options} value="" onChange={() => {}} placeholder="Select" />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'O' });
    expect(activeOptionLabel(listbox)).toBe('Option A');
    fireEvent.keyDown(listbox, { key: 'p' });
    expect(activeOptionLabel(listbox)).toBe('Option A');
  });

  it('selects highlighted option with Enter after typeahead', () => {
    const onChange = vi.fn();
    render(<Select options={options} value="" onChange={onChange} placeholder="Select" />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'c' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('moves to last option on End and first on Home', () => {
    render(<Select options={options} value="" onChange={() => {}} placeholder="Select" />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'End' });
    expect(activeOptionLabel(listbox)).toBe('Option C');
    fireEvent.keyDown(listbox, { key: 'Home' });
    expect(activeOptionLabel(listbox)).toBe('Option A');
  });
});
