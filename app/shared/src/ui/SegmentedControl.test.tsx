import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

describe('SegmentedControl', () => {
  it('renders options and marks the active value', () => {
    render(
      <SegmentedControl
        ariaLabel="Thread filters"
        value="active"
        onChange={vi.fn()}
        options={[
          { value: 'all', label: 'All', meta: 3 },
          { value: 'active', label: 'Active', meta: 2 },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Active 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('fires onChange with the selected value', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Run sections"
        value="review"
        onChange={onChange}
        options={[
          { value: 'review', label: 'Review' },
          { value: 'logs', label: 'Logs' },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));

    expect(onChange).toHaveBeenCalledWith('logs');
  });

  it('accepts mobile class overrides', () => {
    render(
      <SegmentedControl
        ariaLabel="Language"
        value="en"
        onChange={vi.fn()}
        className="mobileSegmentedToolbar"
        optionClassName="mobileSegmentButton"
        activeOptionClassName="mobileSegmentButtonActive"
        options={[
          { value: 'en', label: 'English' },
          { value: 'zh', label: 'Chinese' },
        ]}
      />,
    );

    expect(screen.getByLabelText('Language')).toHaveClass('mobileSegmentedToolbar');
    expect(screen.getByRole('button', { name: 'English' })).toHaveClass('mobileSegmentButtonActive');
  });
});
