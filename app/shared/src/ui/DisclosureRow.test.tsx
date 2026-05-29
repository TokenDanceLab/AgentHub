import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DisclosureRow } from './DisclosureRow';

function ControlledDisclosureRow() {
  const [expanded, setExpanded] = useState(false);
  return (
    <DisclosureRow
      label="Session initialized"
      meta="acceptEdits"
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    >
      <span>Tools: Read Write Bash</span>
    </DisclosureRow>
  );
}

describe('DisclosureRow', () => {
  it('renders compact label and meta', () => {
    render(
      <DisclosureRow label="Run completed" meta="failed" expanded={false} onToggle={() => {}} />,
    );

    expect(screen.getByRole('button', { name: /Run completed/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('toggles body content from the owning component state', () => {
    render(<ControlledDisclosureRow />);

    expect(screen.queryByText('Tools: Read Write Bash')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Session initialized/i }));

    expect(screen.getByRole('button', { name: /Session initialized/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Tools: Read Write Bash')).toBeInTheDocument();
  });

  it('accepts consuming app class overrides', () => {
    render(
      <DisclosureRow
        className="statusRow"
        buttonClassName="statusRowHeader"
        labelClassName="statusRowLabel"
        metaClassName="statusRowMeta"
        bodyClassName="statusRowBody"
        label="Session"
        meta="plan"
        expanded
        onToggle={() => {}}
      >
        <span>Body</span>
      </DisclosureRow>,
    );

    const button = screen.getByRole('button', { name: /Session/i });

    expect(button.closest('.statusRow')).toBeInTheDocument();
    expect(button).toHaveClass('statusRowHeader');
    expect(screen.getByText('Session')).toHaveClass('statusRowLabel');
    expect(screen.getByText('plan')).toHaveClass('statusRowMeta');
    expect(screen.getByText('Body').parentElement).toHaveClass('statusRowBody');
  });
});
