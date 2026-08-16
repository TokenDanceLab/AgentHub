// InlineDelegationCard tests — #1406 Phase 3
// Verifies the inline delegation card renders from MessageDelegationStore
// entries, shows the correct per-status presentation, expands/collapses,
// and mounts below a user message via the Transcript renderUserFooter slot.

import { render, screen, fireEvent, act } from '@testing-library/react';
import { beforeAll, describe, expect, it, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { HUB_EVENTS } from '../../hubEvents';
import { getMessageDelegationStore } from './MessageDelegationStore';
import { getSubagentStreamStore } from './SubagentStreamStore';
import { InlineDelegationCard } from './InlineDelegationCard';
import { Transcript } from '../../chatview/components/Transcript';

// The delegation card + transcript labels resolve through the shared test
// i18next instance; opt into the zh bundle for this suite (Issue #1717).
import { useTestI18nLanguage } from '../../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

// jsdom has no layout engine, so virtua cannot measure the viewport/rows and
// would mount zero rows — breaking content-level queries. These tests cover
// the delegation-card business logic, not virtualization, so a passthrough
// Virtualizer (render every child) preserves their semantics. The real
// Virtualizer is exercised by Transcript.autoscroll.test.tsx (scroll
// contract) and Transcript.virtualization.test.tsx (handle wiring).
vi.mock('virtua', () => ({
  Virtualizer: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

// InlineDelegationCard + SubagentTranscript resolve status labels via the
// chatview i18n namespace; the registered test instance provides the real
// zh copy.
import type { TranscriptUserItem } from '../../chatview/transcript-item';

function feedDispatch(overrides: Record<string, unknown> = {}): void {
  getMessageDelegationStore().handleEvent(HUB_EVENTS.AGENT_DISPATCH, {
    task_id: overrides.task_id ?? 'task-1',
    trigger_message_id: overrides.trigger_message_id ?? 'msg-1',
    display_name: overrides.display_name ?? 'Researcher',
    session_id: 'sess-1',
    agent_instance_id: 'inst-1',
    created_at: overrides.created_at ?? '2026-07-31T00:00:00Z',
    ...overrides,
  });
}

function feedEvent(eventType: string, overrides: Record<string, unknown> = {}): void {
  getMessageDelegationStore().handleEvent(eventType, {
    task_id: overrides.task_id ?? 'task-1',
    created_at: overrides.created_at ?? '2026-07-31T00:00:01Z',
    ...overrides,
  });
}

function userItem(id: string, text: string): TranscriptUserItem {
  return { type: 'user', id, name: 'You', time: '10:00', text };
}

describe('InlineDelegationCard', () => {
  beforeEach(() => {
    getMessageDelegationStore().reset();
    getSubagentStreamStore().reset();
  });

  // ── Empty / null ────────────────────────────────────────────────────────

  it('renders nothing when there are no delegation entries for the message', () => {
    const { container } = render(<InlineDelegationCard messageId="msg-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the message id has no matching entries (other message has one)', () => {
    act(() => feedDispatch({ task_id: 'task-1', trigger_message_id: 'msg-other' }));
    const { container } = render(<InlineDelegationCard messageId="msg-1" />);
    expect(container.firstChild).toBeNull();
  });

  // ── Status presentation ─────────────────────────────────────────────────

  it('renders a dispatching card with the agent display name', () => {
    act(() => feedDispatch({ task_id: 'task-1', display_name: 'Researcher' }));
    render(<InlineDelegationCard messageId="msg-1" />);
    expect(screen.getByText('Researcher')).toBeInTheDocument();
    expect(screen.getByText('派单中…')).toBeInTheDocument();
  });

  it('shows the streaming status label after the first agent.stream', () => {
    act(() => {
      feedDispatch({ task_id: 'task-1' });
      feedEvent(HUB_EVENTS.AGENT_STREAM, { task_id: 'task-1' });
    });
    render(<InlineDelegationCard messageId="msg-1" />);
    expect(screen.getByText('执行中…')).toBeInTheDocument();
  });

  it('shows the done status label after agent.done', () => {
    act(() => {
      feedDispatch({ task_id: 'task-1' });
      feedEvent(HUB_EVENTS.AGENT_DONE, { task_id: 'task-1' });
    });
    render(<InlineDelegationCard messageId="msg-1" />);
    expect(screen.getByText('完成 ✓')).toBeInTheDocument();
  });

  it('shows the failed status label after agent.failed', () => {
    act(() => {
      feedDispatch({ task_id: 'task-1' });
      feedEvent(HUB_EVENTS.AGENT_FAILED, { task_id: 'task-1' });
    });
    render(<InlineDelegationCard messageId="msg-1" />);
    expect(screen.getByText('失败 ✗')).toBeInTheDocument();
  });

  it('shows the cancelled status label after agent.cancel', () => {
    act(() => {
      feedDispatch({ task_id: 'task-1' });
      feedEvent(HUB_EVENTS.AGENT_CANCEL, { task_id: 'task-1' });
    });
    render(<InlineDelegationCard messageId="msg-1" />);
    expect(screen.getByText('已取消')).toBeInTheDocument();
  });

  // ── Multi-agent ─────────────────────────────────────────────────────────

  it('stacks one card per associated task on the same message', () => {
    act(() => {
      feedDispatch({ task_id: 'task-a', display_name: 'Agent A' });
      feedDispatch({ task_id: 'task-b', display_name: 'Agent B' });
    });
    render(<InlineDelegationCard messageId="msg-1" />);
    expect(screen.getByText('Agent A')).toBeInTheDocument();
    expect(screen.getByText('Agent B')).toBeInTheDocument();
    // Each card exposes an aria-label of "<name>: <status>".
    expect(screen.getByLabelText('Agent A: 派单中…')).toBeInTheDocument();
  });

  it('falls back to a task short code when display_name is missing', () => {
    act(() => feedDispatch({ task_id: 'task-abc-xyz789', display_name: '' }));
    render(<InlineDelegationCard messageId="msg-1" />);
    expect(screen.getByText('#xyz789')).toBeInTheDocument();
  });

  it('marks active cards with the avatar pulse class', () => {
    act(() => feedDispatch({ task_id: 'task-1', display_name: 'Researcher' }));
    render(<InlineDelegationCard messageId="msg-1" />);
    const card = document.querySelector('[data-delegation-status="dispatching"]');
    expect(card).not.toBeNull();
    // The avatar is the first span inside the card header button. CSS-module
    // scoped class names retain the original name as a substring
    // (e.g. `_avatarPulse_<hash>`), so a substring check is stable.
    const avatar = card!.querySelector('button span');
    expect(avatar?.className).toContain('avatarPulse');
  });

  // ── Expand / collapse ────────────────────────────────────────────────────

  it('expands on click and shows the empty-stream hint when no stream events', () => {
    act(() => feedDispatch({ task_id: 'task-1', display_name: 'Researcher' }));
    render(<InlineDelegationCard messageId="msg-1" />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('暂无详细事件流')).toBeInTheDocument();

    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders the SubagentTranscript in the expanded view when stream events exist', () => {
    act(() => {
      feedDispatch({ task_id: 'task-1', display_name: 'Researcher' });
      getSubagentStreamStore().push({
        team_run_id: 'run-1',
        team_id: 'team-1',
        session_id: 'sess-1',
        agent_task_id: 'task-1',
        agent_instance_id: 'inst-1',
        event_seq: 1,
        event_type: 'thinking',
        payload: { text: 'reasoning about the task' },
        created_at: '2026-07-31T00:00:02Z',
      });
    });
    render(<InlineDelegationCard messageId="msg-1" />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn); // expand
    // SubagentTranscript renders the thinking category label "思考".
    expect(screen.getByText('思考')).toBeInTheDocument();
    expect(screen.getByText(/reasoning about the task/)).toBeInTheDocument();
  });

  it('updates the card reactively when a later terminal frame arrives', () => {
    act(() => feedDispatch({ task_id: 'task-1', display_name: 'Researcher' }));
    render(<InlineDelegationCard messageId="msg-1" />);
    expect(screen.getByText('派单中…')).toBeInTheDocument();

    act(() => feedEvent(HUB_EVENTS.AGENT_DONE, { task_id: 'task-1' }));
    expect(screen.getByText('完成 ✓')).toBeInTheDocument();
    expect(screen.queryByText('派单中…')).not.toBeInTheDocument();
  });

  // ── Mount into the message timeline (#1406 Phase 3) ─────────────────────

  it('mounts below a user message via the Transcript renderUserFooter slot', () => {
    act(() => feedDispatch({ task_id: 'task-1', display_name: 'Planner', trigger_message_id: 'msg-mount' }));
    render(
      <Transcript
        items={[userItem('msg-mount', '帮我规划一下这个项目')]}
        chatMode="group"
        renderUserFooter={(item) => <InlineDelegationCard messageId={item.id} />}
      />,
    );

    // The user message bubble is present.
    expect(screen.getByText('帮我规划一下这个项目')).toBeInTheDocument();
    // The delegation card is mounted inline below it, subscribed by message id.
    expect(screen.getByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('派单中…')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '子 Agent 委派状态' })).toBeInTheDocument();
  });

  it('renders no card below a user message that triggered no dispatch', () => {
    render(
      <Transcript
        items={[userItem('msg-plain', '一条普通消息')]}
        chatMode="group"
        renderUserFooter={(item) => <InlineDelegationCard messageId={item.id} />}
      />,
    );

    expect(screen.getByText('一条普通消息')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '子 Agent 委派状态' })).not.toBeInTheDocument();
  });
});
