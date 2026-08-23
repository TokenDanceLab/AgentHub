import { StrictMode } from 'react';
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
      // then unmounts. Pin the exit-mounted state before advancing past the
      // window and asserting it is gone.
      expect(screen.getByRole('listbox')).toBeInTheDocument();
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

  // ── #1827: disabled options / error state / resize repositioning ──

  const mixedOptions: Array<[string, string, boolean?]> = [
    ['a', 'Alpha'],
    ['b', 'Blocked', true],
    ['c', 'Gamma'],
  ];

  it('skips disabled options on ArrowDown/ArrowUp navigation', () => {
    render(<Select options={mixedOptions} value="" onChange={() => {}} placeholder="Select" />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    expect(activeOptionLabel(listbox)).toBe('Alpha');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(activeOptionLabel(listbox)).toBe('Gamma');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(activeOptionLabel(listbox)).toBe('Alpha');
  });

  it('does not select a disabled option on Enter or click', () => {
    const onChange = vi.fn();
    render(<Select options={mixedOptions} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    // Keyboard: focus is on Alpha; ArrowDown lands on Gamma skipping Blocked
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('a');
    // Click on the disabled option: no change
    fireEvent.click(listbox.querySelector('[role="option"][aria-disabled="true"]')!);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps disabled options out of Home/End focus', () => {
    render(<Select options={mixedOptions} value="" onChange={() => {}} placeholder="Select" />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'End' });
    expect(activeOptionLabel(listbox)).toBe('Gamma');
    fireEvent.keyDown(listbox, { key: 'Home' });
    expect(activeOptionLabel(listbox)).toBe('Alpha');
  });

  it('reports aria-invalid on the trigger when invalid', () => {
    render(<Select options={options} value="" onChange={() => {}} invalid ariaLabel="Pick" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not set aria-invalid when valid', () => {
    render(<Select options={options} value="" onChange={() => {}} ariaLabel="Pick" />);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-invalid');
  });

  it('recomputes the dropdown anchor on window resize', () => {
    const rect = {
      left: 50, top: 700, bottom: 730, width: 220,
      right: 270, height: 30, x: 50, y: 700, toJSON: () => ({}),
    } as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    const defineHeight = (v: number) => {
      Object.defineProperty(window, 'innerHeight', { value: v, writable: true, configurable: true });
    };
    defineHeight(768);
    const manyOptions = Array.from({ length: 12 }, (_, i) => [`k${i}`, `K${i}`] as [string, string]);
    try {
      render(<Select options={manyOptions} value="" onChange={() => {}} placeholder="Select" />);
      fireEvent.click(screen.getByRole('button'));
      const listbox = screen.getByRole('listbox');
      // 12 options -> ~496px panel; 38px below -> must flip up
      expect(listbox.style.bottom).toBe('74px');
      defineHeight(1200);
      fireEvent(window, new Event('resize'));
      expect(listbox.style.top).toBe('736px');
      expect(listbox.style.bottom).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  // ── StrictMode 双挂载：mount 不得抢焦点（回归）──
  // React 19 + StrictMode 会 mount → 伪 unmount → 再 mount，effect 跑两遍且
  // ref 跨两遍保留。restore-focus effect 若在第二遍把 open=false 当作
  // “已关闭”处理，就会依次 focus 每个 Select trigger，最后一个胜出
  // （右侧栏「状态」表单出现双层蓝焦点环，dev 必现）。此回归固定：
  // 双挂载下无自动 focus。

  it('does not grab focus when mounted under StrictMode double-mount', () => {
    render(
      <StrictMode>
        <Select options={options} value="" onChange={() => {}} placeholder="Select" />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByRole('button')).not.toHaveFocus();
  });

  it('still restores focus to the trigger after close under StrictMode', () => {
    render(
      <StrictMode>
        <Select options={options} value="" onChange={() => {}} placeholder="Select" />
      </StrictMode>,
    );
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });
});
