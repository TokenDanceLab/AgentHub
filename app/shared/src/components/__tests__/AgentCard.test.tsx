import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentCard } from '../AgentCard/AgentCard';
import type { AgentCardData } from '../AgentCard/AgentCard';

function makeAgent(overrides: Partial<AgentCardData> = {}): AgentCardData {
  return {
    id: 'agent-1',
    name: 'Code Reviewer',
    category: 'Development',
    icon: 'code',
    tone: 'blue',
    summary: 'Reviews your pull requests with AI precision.',
    tags: ['code', 'review', 'ai'],
    rating: 4.7,
    installs: '2.3K',
    ...overrides,
  };
}

describe('AgentCard', () => {
  // ── Basic rendering ────────────────────────────

  it('renders the agent name, category, summary, rating, and installs', () => {
    render(<AgentCard agent={makeAgent()} />);

    expect(screen.getByRole('heading', { name: 'Code Reviewer' })).toBeInTheDocument();
    expect(screen.getByText('Development')).toBeInTheDocument();
    expect(screen.getByText('Reviews your pull requests with AI precision.')).toBeInTheDocument();
    expect(screen.getByText('4.7 rating')).toBeInTheDocument();
    expect(screen.getByText('2.3K installs')).toBeInTheDocument();
  });

  // ── Favorite toggle ────────────────────────────

  it('renders the favorite button when onToggleFavorite is provided', () => {
    const onToggle = vi.fn();
    render(<AgentCard agent={makeAgent({ isFavorite: false })} onToggleFavorite={onToggle} />);

    const btn = screen.getByRole('button', { name: 'Favorite Code Reviewer' });
    expect(btn).toBeInTheDocument();
  });

  it('shows unfavorite aria-label when agent is already a favorite', () => {
    const onToggle = vi.fn();
    render(<AgentCard agent={makeAgent({ isFavorite: true })} onToggleFavorite={onToggle} />);

    expect(screen.getByRole('button', { name: 'Unfavorite Code Reviewer' })).toBeInTheDocument();
  });

  it('calls onToggleFavorite with agent id when favorite button is clicked', () => {
    const onToggle = vi.fn();
    render(<AgentCard agent={makeAgent()} onToggleFavorite={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: 'Favorite Code Reviewer' }));
    expect(onToggle).toHaveBeenCalledWith('agent-1');
  });

  it('does not render the favorite button when onToggleFavorite is not provided', () => {
    render(<AgentCard agent={makeAgent({ isFavorite: true })} />);

    expect(screen.queryByRole('button', { name: /favorite/i })).not.toBeInTheDocument();
  });

  // ── Install state rendering ────────────────────

  it('renders the install button with "Add" label when not installed', () => {
    const onInstall = vi.fn();
    render(<AgentCard agent={makeAgent({ isInstalled: false })} onInstall={onInstall} />);

    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  it('renders the install button with "Added" label when installed', () => {
    const onInstall = vi.fn();
    render(<AgentCard agent={makeAgent({ isInstalled: true })} onInstall={onInstall} />);

    expect(screen.getByRole('button', { name: /added/i })).toBeInTheDocument();
  });

  it('calls onInstall with agent id when install button is clicked', () => {
    const onInstall = vi.fn();
    render(<AgentCard agent={makeAgent()} onInstall={onInstall} />);

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onInstall).toHaveBeenCalledWith('agent-1');
  });

  it('does not render the install button when onInstall is not provided', () => {
    render(<AgentCard agent={makeAgent()} />);

    expect(screen.queryByRole('button', { name: /add|added/i })).not.toBeInTheDocument();
  });

  it('uses custom installLabel when provided', () => {
    const onInstall = vi.fn();
    render(
      <AgentCard
        agent={makeAgent()}
        onInstall={onInstall}
        installLabel="Install Now"
      />,
    );

    expect(screen.getByRole('button', { name: /install now/i })).toBeInTheDocument();
  });

  it('disables the install button when installDisabled is true', () => {
    const onInstall = vi.fn();
    render(
      <AgentCard
        agent={makeAgent()}
        onInstall={onInstall}
        installDisabled={true}
      />,
    );

    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
  });

  // ── Tag rendering ──────────────────────────────

  it('renders all tags from the agent data', () => {
    // Use unique tags that don't collide with icon name to avoid multi-match
    render(<AgentCard agent={makeAgent({ tags: ['tag-one', 'tag-two', 'tag-three'] })} />);

    expect(screen.getByText('tag-one')).toBeInTheDocument();
    expect(screen.getByText('tag-two')).toBeInTheDocument();
    expect(screen.getByText('tag-three')).toBeInTheDocument();
  });

  it('renders no tag row when tags array is empty', () => {
    const { container } = render(<AgentCard agent={makeAgent({ tags: [] })} />);

    // The tagRow div should not exist — no <span> elements inside a tagRow container
    const tagRowSpans = container.querySelectorAll('[class*="tagRow"] span');
    expect(tagRowSpans).toHaveLength(0);
  });

  // ── Details button ─────────────────────────────

  it('calls onShowDetails with agent id when details button is clicked', () => {
    const onShowDetails = vi.fn();
    render(<AgentCard agent={makeAgent()} onShowDetails={onShowDetails} />);

    fireEvent.click(screen.getByRole('button', { name: /details/i }));
    expect(onShowDetails).toHaveBeenCalledWith('agent-1');
  });

  it('does not render the details button when onShowDetails is not provided', () => {
    render(<AgentCard agent={makeAgent()} />);

    expect(screen.queryByRole('button', { name: /details/i })).not.toBeInTheDocument();
  });

  // ── Saves display ──────────────────────────────

  it('renders saves stat when saves is provided', () => {
    render(<AgentCard agent={makeAgent({ saves: '1.2K' })} />);

    expect(screen.getByText('1.2K saves')).toBeInTheDocument();
  });

  it('omits saves stat when saves is not set', () => {
    render(<AgentCard agent={makeAgent({ saves: undefined })} />);

    expect(screen.queryByText(/saves/)).not.toBeInTheDocument();
  });

  // ── Custom footer ──────────────────────────────

  it('renders custom footer instead of default actions when provided', () => {
    render(
      <AgentCard agent={makeAgent()} footer={<button>Custom Action</button>} />,
    );

    expect(screen.getByRole('button', { name: 'Custom Action' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /details/i })).not.toBeInTheDocument();
  });

  // ── CSS interactions ───────────────────────────

  it('applies custom className when provided', () => {
    const { container } = render(
      <AgentCard agent={makeAgent()} className="custom-card" />,
    );

    expect(container.firstElementChild).toHaveClass('custom-card');
  });
});
