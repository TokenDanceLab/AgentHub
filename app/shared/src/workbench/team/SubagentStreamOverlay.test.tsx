import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, beforeEach, vi } from 'vitest';
import {
  createSubagentStreamStore,
  type SubagentStreamStore,
} from './SubagentStreamStore';
import { SubagentStreamOverlay } from './SubagentStreamOverlay';

// SubagentStreamOverlay + SubagentSessionDialog resolve dialog/open-button
// labels via the sharedWorkbench namespace, and SubagentTranscript (rendered
// inside the expanded overlay) uses the chatview namespace for its category
// labels and empty hint. The registered test instance provides the real zh
// copy for both namespaces once this suite opts into zh (Issue #1717).
import { useTestI18nLanguage } from '../../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

// Mock getSubagentStreamStore to return a test-controlled store.
let testStore: SubagentStreamStore;

vi.mock('./SubagentStreamStore', async () => {
  const actual = await vi.importActual<typeof import('./SubagentStreamStore')>('./SubagentStreamStore');
  return {
    ...actual,
    getSubagentStreamStore: () => testStore,
  };
});

function makeEvent(overrides: Partial<{
  team_run_id: string;
  team_id: string;
  session_id: string;
  agent_task_id: string;
  agent_instance_id: string;
  event_seq: number;
  event_type: string;
  payload: unknown;
  created_at: string;
  member_id: string;
}> = {}): Record<string, unknown> {
  return {
    team_run_id: overrides.team_run_id ?? 'run-1',
    team_id: overrides.team_id ?? 'team-1',
    session_id: overrides.session_id ?? 'sess-1',
    agent_task_id: overrides.agent_task_id ?? 'task-abc123',
    agent_instance_id: overrides.agent_instance_id ?? 'inst-1',
    event_seq: overrides.event_seq ?? 1,
    event_type: overrides.event_type ?? 'thinking',
    payload: overrides.payload ?? { text: 'thinking...' },
    created_at: overrides.created_at ?? new Date().toISOString(),
    member_id: overrides.member_id ?? 'TestAgent',
  };
}

describe('SubagentStreamOverlay', () => {
  beforeEach(() => {
    testStore = createSubagentStreamStore();
  });

  it('renders nothing when store is empty', () => {
    const { container } = render(<SubagentStreamOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a chip when a stream event arrives', () => {
    act(() => {
      testStore.push(makeEvent({ agent_task_id: 'task-1', event_type: 'thinking' }));
    });
    render(<SubagentStreamOverlay />);
    expect(screen.getByText('TestAgent')).toBeInTheDocument();
  });

  it('shows correct status label for thinking', () => {
    act(() => {
      testStore.push(makeEvent({ agent_task_id: 'task-1', event_type: 'thinking' }));
    });
    render(<SubagentStreamOverlay />);
    expect(screen.getByText('思考中…')).toBeInTheDocument();
  });

  it('shows correct status label for done', () => {
    act(() => {
      testStore.push(makeEvent({ agent_task_id: 'task-1', event_type: 'done' }));
    });
    render(<SubagentStreamOverlay />);
    expect(screen.getByText('完成 ✓')).toBeInTheDocument();
  });

  it('shows correct status label for failed', () => {
    act(() => {
      testStore.push(makeEvent({ agent_task_id: 'task-1', event_type: 'failed' }));
    });
    render(<SubagentStreamOverlay />);
    expect(screen.getByText('失败 ✗')).toBeInTheDocument();
  });

  it('renders multiple chips for different tasks', () => {
    act(() => {
      testStore.push(makeEvent({ agent_task_id: 'task-1', member_id: 'Agent A', event_type: 'thinking' }));
      testStore.push(makeEvent({ agent_task_id: 'task-2', member_id: 'Agent B', event_type: 'running' }));
    });
    render(<SubagentStreamOverlay maxVisible={5} />);
    expect(screen.getByText('Agent A')).toBeInTheDocument();
    expect(screen.getByText('Agent B')).toBeInTheDocument();
  });

  it('respects maxVisible limit', () => {
    act(() => {
      testStore.push(makeEvent({ agent_task_id: 'task-1', member_id: 'A', event_type: 'thinking' }));
      testStore.push(makeEvent({ agent_task_id: 'task-2', member_id: 'B', event_type: 'thinking' }));
      testStore.push(makeEvent({ agent_task_id: 'task-3', member_id: 'C', event_type: 'thinking' }));
      testStore.push(makeEvent({ agent_task_id: 'task-4', member_id: 'D', event_type: 'thinking' }));
    });
    render(<SubagentStreamOverlay maxVisible={2} />);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    // Only first 2 chips visible: 2 toggle buttons + 2 drill-down buttons
    // (the +N badge is not a button).
    expect(screen.getAllByRole('button').length).toBe(4);
    expect(document.querySelectorAll('[aria-expanded]').length).toBe(2);
  });

  it('expands chip on click', () => {
    act(() => {
      testStore.push(makeEvent({
        agent_task_id: 'task-1',
        event_type: 'thinking',
        event_seq: 1,
        payload: { text: 'I am thinking' },
      }));
    });
    render(<SubagentStreamOverlay />);
    const chipBtn = screen.getByRole('button', { name: /TestAgent:/ });
    expect(chipBtn).toHaveAttribute('aria-expanded', 'true'); // default expanded for active

    // Collapse it first
    fireEvent.click(chipBtn);
    expect(chipBtn).toHaveAttribute('aria-expanded', 'false');

    // Expand again
    fireEvent.click(chipBtn);
    expect(chipBtn).toHaveAttribute('aria-expanded', 'true');

    // Should show event detail (Phase 3: thinking → 思考 label via SubagentTranscript)
    expect(screen.getByText('思考')).toBeInTheDocument();
  });

  it('renders event details when expanded', () => {
    act(() => {
      testStore.push(makeEvent({
        agent_task_id: 'task-1',
        event_type: 'thinking',
        event_seq: 1,
        payload: { text: 'Step 1 reasoning' },
      }));
      testStore.push(makeEvent({
        agent_task_id: 'task-1',
        event_type: 'tool_call',
        event_seq: 2,
        payload: { tool_name: 'read_file', input: 'config.json' },
      }));
    });
    render(<SubagentStreamOverlay />);
    // Phase 3: event_type renders as Chinese label via SubagentTranscript
    expect(screen.getByText('思考')).toBeInTheDocument();
    expect(screen.getByText('工具调用')).toBeInTheDocument();
    expect(screen.getByText(/Step 1 reasoning/)).toBeInTheDocument();
    expect(screen.getByText(/read_file/)).toBeInTheDocument();
  });

  it('deduplicates events by event_seq', () => {
    act(() => {
      testStore.push(makeEvent({ agent_task_id: 'task-1', event_seq: 1, event_type: 'thinking' }));
      testStore.push(makeEvent({ agent_task_id: 'task-1', event_seq: 1, event_type: 'thinking' }));
      testStore.push(makeEvent({ agent_task_id: 'task-1', event_seq: 2, event_type: 'text_delta' }));
    });
    render(<SubagentStreamOverlay />);
    // Should have 2 unique event entries, not 3 (Phase 3: SubagentTranscript uses [data-event-category])
    const eventRows = document.querySelectorAll('[data-event-category]');
    expect(eventRows.length).toBe(2);
  });

  it('falls back to task short code when no display name', () => {
    act(() => {
      testStore.push(makeEvent({
        agent_task_id: 'task-xyz789',
        event_type: 'running',
        member_id: '', // empty member_id
        payload: {}, // no display_name/agent_name
      }));
    });
    render(<SubagentStreamOverlay />);
    expect(screen.getByText('#xyz789')).toBeInTheDocument();
  });

  it('shows status color classes on chips', () => {
    act(() => {
      testStore.push(makeEvent({ agent_task_id: 'task-1', event_type: 'thinking' }));
      testStore.push(makeEvent({ agent_task_id: 'task-2', event_type: 'done' }));
    });
    render(<SubagentStreamOverlay />);
    // At least the thinking chip should have a status color class
    const chips = document.querySelectorAll('[data-stream-status]');
    expect(chips.length).toBe(2);
    expect(chips[0]!.getAttribute('data-stream-status')).toBe('thinking'); // active first
  });

  it('renders text_delta content in expanded view', () => {
    act(() => {
      testStore.push(makeEvent({
        agent_task_id: 'task-1',
        event_type: 'text_delta',
        event_seq: 1,
        payload: { delta: 'Hello from agent' },
      }));
    });
    render(<SubagentStreamOverlay />);
    expect(screen.getByText(/Hello from agent/)).toBeInTheDocument();
  });

  it('supports position prop', () => {
    act(() => {
      testStore.push(makeEvent({ agent_task_id: 'task-1', event_type: 'running' }));
    });
    render(<SubagentStreamOverlay position="bottom-left" />);
    const region = screen.getByRole('region');
    expect(region.className).toContain('positionLeft');
    expect(region.className).not.toContain('positionRight');
  });

  // ── Full-session drill-down dialog (#1406 follow-up) ──

  it('opens the full-session dialog from the chip drill-down button', () => {
    act(() => {
      testStore.push(makeEvent({
        agent_task_id: 'task-1',
        member_id: 'Agent A',
        event_type: 'thinking',
        event_seq: 1,
        payload: { text: 'Deep reasoning step' },
      }));
    });
    render(<SubagentStreamOverlay />);

    // No dialog before clicking the drill-down button.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开完整会话' }));

    // Dialog opens with the agent name in the title and the full transcript.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('Agent A');
    expect(within(dialog).getByText('思考')).toBeInTheDocument();
    expect(within(dialog).getByText(/Deep reasoning step/)).toBeInTheDocument();
  });

  it('closes the dialog via the modal close button', () => {
    act(() => {
      testStore.push(makeEvent({ agent_task_id: 'task-1', event_type: 'thinking', event_seq: 1 }));
    });
    render(<SubagentStreamOverlay />);
    fireEvent.click(screen.getByRole('button', { name: '打开完整会话' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the selected sub-session only when multiple chips exist', () => {
    act(() => {
      testStore.push(makeEvent({
        agent_task_id: 'task-1',
        member_id: 'Agent A',
        event_type: 'thinking',
        event_seq: 1,
        payload: { text: 'A-only reasoning' },
      }));
      testStore.push(makeEvent({
        agent_task_id: 'task-2',
        member_id: 'Agent B',
        event_type: 'done',
        event_seq: 1,
        payload: { summary: 'B-only result' },
      }));
    });
    render(<SubagentStreamOverlay maxVisible={5} />);

    // Two drill-down buttons; open the first (active thinking first).
    const openButtons = screen.getAllByRole('button', { name: '打开完整会话' });
    expect(openButtons.length).toBe(2);
    fireEvent.click(openButtons[0]!);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/A-only reasoning/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/B-only result/)).not.toBeInTheDocument();
  });
});
