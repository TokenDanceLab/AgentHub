import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('closes on Escape', () => {
    render(<Select options={options} value="" onChange={() => {}} placeholder="Select" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('navigates with ArrowDown and selects with Enter', () => {
    const onChange = vi.fn();
    render(<Select options={[['x', 'X'], ['y', 'Y']]} value="x" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('y');
  });
});
