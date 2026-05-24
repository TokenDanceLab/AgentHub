import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MentionPopover from '@/components/MentionPopover';
import type { AgentInfo } from '@shared/types';

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    status: 'available',
    capabilities: {
      streaming: true,
      toolCalls: false,
      fileChanges: false,
      thinkingVisible: false,
      multiTurn: false,
    },
    ...overrides,
  };
}

describe('MentionPopover', () => {
  const defaultProps = {
    agents: [] as AgentInfo[],
    isOpen: true,
    query: '',
    position: { top: 0, left: 0 },
    selectedIndex: 0,
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders agent list when isOpen', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' }), makeAgent({ id: 'a2', name: 'Beta' })];
    render(<MentionPopover {...defaultProps} agents={agents} />);

    const listbox = screen.getByRole('listbox', { name: 'Agent suggestions' });
    expect(listbox).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionPopover {...defaultProps} agents={agents} isOpen={false} />);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('does not render when agents list is empty', () => {
    render(<MentionPopover {...defaultProps} agents={[]} isOpen={true} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('highlights selected item with aria-selected', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' }), makeAgent({ id: 'a2', name: 'Beta' })];
    render(<MentionPopover {...defaultProps} agents={agents} selectedIndex={1} />);

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onSelect when an agent item is clicked', () => {
    const onSelect = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' }), makeAgent({ id: 'a2', name: 'Beta' })];
    render(<MentionPopover {...defaultProps} agents={agents} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Alpha'));
    expect(onSelect).toHaveBeenCalledWith(agents[0]);
  });

  it('calls onClose on outside mousedown', async () => {
    const onClose = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionPopover {...defaultProps} agents={agents} onClose={onClose} />);

    // Wait for the setTimeout in the outside click handler
    await new Promise((r) => setTimeout(r, 10));

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('highlights matching query in agent names', () => {
    const agents = [makeAgent({ id: 'a1', name: 'ClaudeCode' }), makeAgent({ id: 'a2', name: 'OpenCode' })];
    render(<MentionPopover {...defaultProps} agents={agents} query="Claude" />);

    // The matching part should be wrapped in a span with class "match"
    const matchEl = document.querySelector('[class*=match]');
    expect(matchEl).not.toBeNull();
    expect(matchEl?.textContent).toBe('Claude');
  });

  it('does not highlight when query does not match', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionPopover {...defaultProps} agents={agents} query="Xyz" />);

    // Highlight should not appear since query doesn't match the displayed name
    const matchEl = document.querySelector('[class*=match]');
    expect(matchEl).toBeNull();
  });

  it('renders agent description when available', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha', description: 'A helpful agent' })];
    render(<MentionPopover {...defaultProps} agents={agents} />);

    expect(screen.getByText('A helpful agent')).toBeInTheDocument();
  });
});
