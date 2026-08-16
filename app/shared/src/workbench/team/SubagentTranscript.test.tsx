import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { TeamSubagentStreamEvent } from './SubagentStreamStore';
import { SubagentTranscript } from './SubagentTranscript';

// SubagentTranscript resolves category labels + empty hint via the chatview
// i18n namespace; the registered test instance provides the real zh copy
// once this suite opts into the zh bundle (Issue #1717).
import { useTestI18nLanguage } from '../../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});
function makeEvent(overrides: Partial<TeamSubagentStreamEvent>): TeamSubagentStreamEvent {
  return {
    team_run_id: 'run-1',
    team_id: 'team-1',
    session_id: 'sess-1',
    agent_task_id: 'task-1',
    agent_instance_id: 'inst-1',
    event_seq: 1,
    event_type: 'thinking',
    payload: { text: 'thought' },
    created_at: new Date().toISOString(),
    ...overrides,
  } as TeamSubagentStreamEvent;
}

describe('SubagentTranscript', () => {
  it('renders empty hint when no events', () => {
    render(<SubagentTranscript events={[]} />);
    expect(screen.getByText('等待 agent 启动…')).toBeInTheDocument();
  });

  it('renders no empty hint when showEmpty=false', () => {
    const { container } = render(<SubagentTranscript events={[]} showEmpty={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Chinese label + seq for each event', () => {
    render(
      <SubagentTranscript
        events={[
          makeEvent({ event_seq: 1, event_type: 'thinking', payload: { text: 'reasoning...' } }),
          makeEvent({ event_seq: 2, event_type: 'tool_call', payload: { tool_name: 'read_file' } }),
        ]}
      />,
    );
    expect(screen.getByText('思考')).toBeInTheDocument();
    expect(screen.getByText('工具调用')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('renders payload content for text_delta', () => {
    render(
      <SubagentTranscript
        events={[makeEvent({ event_seq: 3, event_type: 'text_delta', payload: { delta: 'Hello world' } })]}
      />,
    );
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
  });

  it('renders error payload', () => {
    render(
      <SubagentTranscript
        events={[makeEvent({ event_seq: 4, event_type: 'run.failed', payload: { error: 'boom' } })]}
      />,
    );
    expect(screen.getByText('错误')).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it('assigns data-event-category attribute per type', () => {
    const { container } = render(
      <SubagentTranscript
        events={[
          makeEvent({ event_seq: 1, event_type: 'thinking' }),
          makeEvent({ event_seq: 2, event_type: 'tool_call', payload: { tool_name: 't' } }),
        ]}
      />,
    );
    const entries = container.querySelectorAll('[data-event-category]');
    expect(entries.length).toBe(2);
    expect(entries[0]!.getAttribute('data-event-category')).toBe('thinking');
    expect(entries[1]!.getAttribute('data-event-category')).toBe('tool_call');
  });
});
