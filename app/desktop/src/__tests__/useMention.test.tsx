vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useMention } from '@/hooks/useMention';
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

/**
 * Test wrapper that renders a textarea + uses the useMention hook.
 * Exposes hook state via data attributes on the container for assertions.
 */
function MentionTestWrapper({
  agents,
  onSelectAgent,
}: {
  agents: AgentInfo[];
  onSelectAgent: (id: string) => void;
}) {
  const {
    isOpen,
    query,
    selectedIndex,
    filteredAgents,
    handleInput,
    handleKeyDown,
    selectAgent,
    closeMention,
  } = useMention({ agents, onSelectAgent });

  return (
    <div>
      <textarea
        data-testid="mention-textarea"
        onInput={handleInput}
        onKeyDown={(e) => handleKeyDown(e)}
      />
      <div data-testid="mention-state" data-open={isOpen ? 'true' : 'false'}>
        <span data-testid="mention-query">{query}</span>
        <span data-testid="mention-index">{selectedIndex}</span>
        <span data-testid="mention-count">{filteredAgents.length}</span>
      </div>
      {isOpen && (
        <ul data-testid="mention-list">
          {filteredAgents.map((a, i) => (
            <li key={a.id} data-selected={i === selectedIndex ? 'true' : 'false'}>
              <button onClick={() => selectAgent(a)}>{a.name}</button>
            </li>
          ))}
        </ul>
      )}
      <button data-testid="close-mention" onClick={closeMention}>
        Close
      </button>
    </div>
  );
}

/** Set textarea value + cursor, then fire input to trigger mention detection. */
function typeInTextarea(value: string, cursorPos?: number) {
  const ta = screen.getByTestId('mention-textarea') as HTMLTextAreaElement;
  ta.focus();
  ta.value = value;
  const pos = cursorPos ?? value.length;
  ta.selectionStart = pos;
  ta.selectionEnd = pos;
  fireEvent.input(ta);
}

describe('useMention', () => {
  it('opens popover when @ is typed at word boundary', () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    typeInTextarea(' @Alp', 5);
    const state = screen.getByTestId('mention-state');
    expect(state.dataset.open).toBe('true');
    expect(screen.getByTestId('mention-query').textContent).toBe('Alp');
    expect(screen.getByTestId('mention-count').textContent).toBe('1');
  });

  it('does not open when @ is not at word boundary', () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    // @ in the middle of a word (email-like) should not trigger
    typeInTextarea('test@Alp', 8);
    const state = screen.getByTestId('mention-state');
    expect(state.dataset.open).toBe('false');
  });

  it('closes popover when query contains a space', () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    typeInTextarea(' @Alp ha', 5);
    const state = screen.getByTestId('mention-state');
    expect(state.dataset.open).toBe('true');
    expect(screen.getByTestId('mention-query').textContent).toBe('Alp');

    // Move cursor past space → mention should close
    typeInTextarea(' @Alp ha', 8);
    expect(state.dataset.open).toBe('false');
  });

  it('closes popover via closeMention callback', () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    typeInTextarea(' @Alp', 5);
    expect(screen.getByTestId('mention-state').dataset.open).toBe('true');

    fireEvent.click(screen.getByTestId('close-mention'));
    expect(screen.getByTestId('mention-state').dataset.open).toBe('false');
  });

  it('navigates with ArrowDown and ArrowUp', () => {
    const onSelectAgent = vi.fn();
    const agents = [
      makeAgent({ id: 'a1', name: 'Alpha' }),
      makeAgent({ id: 'a2', name: 'Beta' }),
      makeAgent({ id: 'a3', name: 'Gamma' }),
    ];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    typeInTextarea(' @', 2);

    // All three agents should match
    expect(screen.getByTestId('mention-count').textContent).toBe('3');
    expect(screen.getByTestId('mention-index').textContent).toBe('0');

    const ta = screen.getByTestId('mention-textarea');
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    expect(screen.getByTestId('mention-index').textContent).toBe('1');

    fireEvent.keyDown(ta, { key: 'ArrowUp' });
    expect(screen.getByTestId('mention-index').textContent).toBe('0');
  });

  it('selects agent on Enter key', () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    typeInTextarea(' @Alp', 5);
    const ta = screen.getByTestId('mention-textarea');
    fireEvent.keyDown(ta, { key: 'Enter' });

    expect(onSelectAgent).toHaveBeenCalledWith('a1');
    expect(screen.getByTestId('mention-state').dataset.open).toBe('false');
  });

  it('selects agent on Tab key', () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    typeInTextarea(' @Alp', 5);
    const ta = screen.getByTestId('mention-textarea');
    fireEvent.keyDown(ta, { key: 'Tab' });

    expect(onSelectAgent).toHaveBeenCalledWith('a1');
  });

  it('closes popover on Escape key', () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    typeInTextarea(' @Alp', 5);
    expect(screen.getByTestId('mention-state').dataset.open).toBe('true');

    const ta = screen.getByTestId('mention-textarea');
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.getByTestId('mention-state').dataset.open).toBe('false');
  });

  it('filters agents by query case-insensitively', () => {
    const onSelectAgent = vi.fn();
    const agents = [
      makeAgent({ id: 'a1', name: 'ClaudeCode' }),
      makeAgent({ id: 'a2', name: 'OpenCode' }),
    ];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    typeInTextarea(' @code', 6);
    expect(screen.getByTestId('mention-count').textContent).toBe('2');
  });

  it('does not trigger mention selection when popover is closed', () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    const ta = screen.getByTestId('mention-textarea');

    // Popover is closed — pressing Enter should NOT call onSelectAgent
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSelectAgent).not.toHaveBeenCalled();
    expect(screen.getByTestId('mention-state').dataset.open).toBe('false');
  });

  it('removes @query text from textarea when agent is selected', async () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(<MentionTestWrapper agents={agents} onSelectAgent={onSelectAgent} />);

    const ta = screen.getByTestId('mention-textarea') as HTMLTextAreaElement;
    ta.focus();
    ta.value = 'Hello @Alp';
    ta.selectionStart = 10;
    ta.selectionEnd = 10;
    fireEvent.input(ta);

    expect(screen.getByTestId('mention-state').dataset.open).toBe('true');

    // Click the agent in the popover
    const agentBtn = screen.getByText('Alpha');
    fireEvent.click(agentBtn);

    // The @Alp (and the space before it) should be removed, leaving 'Hello'
    expect(onSelectAgent).toHaveBeenCalledWith('a1');
    expect(ta.value).toBe('Hello');
  });
});
