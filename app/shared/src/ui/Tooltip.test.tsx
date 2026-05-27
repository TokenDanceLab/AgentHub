import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders children and a hidden tooltip', () => {
    render(
      <Tooltip content="Hello tooltip">
        <button type="button">Hover me</button>
      </Tooltip>,
    );

    expect(screen.getByRole('button', { name: 'Hover me' })).toBeInTheDocument();
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).toHaveTextContent('Hello tooltip');
  });

  it('defaults position to top', () => {
    render(
      <Tooltip content="Top tip">
        <span>Child</span>
      </Tooltip>,
    );

    const host = screen.getByText('Child').closest('[data-tooltip-position]');
    expect(host).toHaveAttribute('data-tooltip-position', 'top');
  });

  it('applies the specified position', () => {
    render(
      <Tooltip content="Bottom tip" position="bottom">
        <span>Child</span>
      </Tooltip>,
    );

    const host = screen.getByText('Child').closest('[data-tooltip-position]');
    expect(host).toHaveAttribute('data-tooltip-position', 'bottom');
  });

  it('renders tooltip text', () => {
    render(
      <Tooltip content="Settings" position="right">
        <button type="button">Open</button>
      </Tooltip>,
    );

    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Settings');
  });
});
