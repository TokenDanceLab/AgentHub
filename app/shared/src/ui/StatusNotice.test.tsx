import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusNotice } from './StatusNotice';

describe('StatusNotice', () => {
  it('renders a polite status by default', () => {
    render(<StatusNotice icon={<span>i</span>}>Hub is online</StatusNotice>);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveTextContent('Hub is online');
  });

  it('renders an action slot', () => {
    render(
      <StatusNotice action={<button type="button">Retry</button>}>
        Reply stayed local
      </StatusNotice>,
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('accepts mobile class overrides', () => {
    render(
      <StatusNotice className="mobileSignalRow" iconClassName="mobileSignalIcon">
        Mobile signal
      </StatusNotice>,
    );

    expect(screen.getByRole('status')).toHaveClass('mobileSignalRow');
    expect(screen.queryByText('i')).not.toBeInTheDocument();
  });
});
