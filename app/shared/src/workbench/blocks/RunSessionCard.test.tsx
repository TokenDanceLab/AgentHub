import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunSessionCard } from './RunSessionCard';

describe('RunSessionCard', () => {
  it('renders Agent, Runtime, and Target evidence labels without relying on fallback names', () => {
    render(
      <RunSessionCard
        agentLabel="Hub Builder"
        runtimeLabel="claude-code"
        targetLabel="Online Desktop Edge"
        title="Hub task replay"
      />,
    );

    expect(screen.getByText('Agent: Hub Builder')).toBeInTheDocument();
    expect(screen.getByText('Runtime: claude-code')).toBeInTheDocument();
    expect(screen.getByText('Target: Online Desktop Edge')).toBeInTheDocument();
    expect(screen.queryByText('Agent: Agent')).not.toBeInTheDocument();
  });
});
