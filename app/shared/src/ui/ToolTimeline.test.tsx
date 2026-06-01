import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolTimeline, type ToolTimelineBlock, type ToolTimelineLabels } from './ToolTimeline';

describe('ToolTimeline', () => {
  it('returns null when fewer than 2 entries', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'tool_use', callId: 'c1', toolName: 'bash', input: {}, status: 'completed' },
    ];
    const { container } = render(<ToolTimeline blocks={blocks as any} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders timeline entries for valid block types', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'tool_use', callId: 'c1', toolName: 'bash', input: { command: 'ls' }, status: 'completed' },
      { kind: 'file_change', path: 'src/app.ts', action: 'modified' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    expect(screen.getByTestId('tool-timeline')).toBeDefined();
    const entries = screen.getAllByTestId('tool-timeline-entry');
    expect(entries).toHaveLength(2);
  });

  it('displays tool name for tool_use blocks', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'tool_use', callId: 'c1', toolName: 'Read', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c2', toolName: 'Write', input: {}, status: 'running' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    expect(screen.getByText('Read')).toBeDefined();
    expect(screen.getByText('Write')).toBeDefined();
  });

  it('displays basename for file_change blocks', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'file_change', path: 'src/components/Modal.tsx', action: 'modified' },
      { kind: 'file_change', path: 'README.md', action: 'deleted' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    expect(screen.getByText('Modal.tsx', { exact: true })).toBeDefined();
    expect(screen.getByText('README.md', { exact: true })).toBeDefined();
  });

  it('displays file action as meta for file_change blocks', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'file_change', path: 'src/a.ts', action: 'created' },
      { kind: 'file_change', path: 'src/b.ts', action: 'modified' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    // The action text appears in the meta span
    expect(screen.getByText('created')).toBeDefined();
  });

  it('displays task title for agent_task blocks', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'agent_task', taskId: 't1', title: 'Fix linter errors', status: 'completed' },
      { kind: 'agent_task', taskId: 't2', title: 'Write tests', status: 'running' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    expect(screen.getByText('Fix linter errors')).toBeDefined();
    expect(screen.getByText('Write tests')).toBeDefined();
  });

  it('displays worker as meta for agent_task blocks', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'agent_task', taskId: 't1', title: 'Task A', status: 'completed', worker: 'opus' },
      { kind: 'agent_task', taskId: 't2', title: 'Task B', status: 'completed' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    expect(screen.getByText('opus')).toBeDefined();
  });

  it('displays child agent title for child_agent blocks', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'child_agent', childId: 'a1', title: 'Review PR', status: 'completed' },
      { kind: 'child_agent', childId: 'a2', title: 'Run tests', status: 'running', agentName: 'sonnet' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    expect(screen.getByText('Review PR')).toBeDefined();
    expect(screen.getByText('Run tests')).toBeDefined();
    expect(screen.getByText('sonnet')).toBeDefined();
  });

  it('displays route decision label for route_decision blocks', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'route_decision', action: 'review', instructions: 'Review the code changes' },
      { kind: 'route_decision', action: 'block', blockedReason: 'Security scan required' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    expect(screen.getByText('Review the code changes')).toBeDefined();
    expect(screen.getByText('Security scan required')).toBeDefined();
  });

  it('uses summary as label when instructions is absent in route_decision', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'route_decision', action: 'next', summary: 'Proceed to deploy' },
      { kind: 'route_decision', action: 'test', summary: 'Test summary' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    expect(screen.getByText('Proceed to deploy')).toBeDefined();
  });

  it('falls back to action as label for route_decision', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'route_decision', action: 'reroute' },
      { kind: 'route_decision', action: 'approve' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    // The action appears as both the main label (<strong title="reroute">) and
    // the meta (<span>action text</span>). Expect at least 2 occurrences.
    const rerouteEls = screen.getAllByText('reroute');
    expect(rerouteEls.length).toBeGreaterThanOrEqual(2);
  });

  it('shows correct status labels', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'tool_use', callId: 'c1', toolName: 'bash', input: {}, status: 'pending' },
      { kind: 'tool_use', callId: 'c2', toolName: 'read', input: {}, status: 'running' },
      { kind: 'tool_use', callId: 'c3', toolName: 'write', input: {}, status: 'draining' },
      { kind: 'tool_use', callId: 'c4', toolName: 'edit', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c5', toolName: 'grep', input: {}, status: 'failed' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    expect(screen.getByText('pending')).toBeDefined();
    expect(screen.getByText('running')).toBeDefined();
    expect(screen.getByText('draining')).toBeDefined();
    expect(screen.getByText('done')).toBeDefined();
    expect(screen.getByText('failed')).toBeDefined();
  });

  it('displays block count in header', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'tool_use', callId: 'c1', toolName: 'bash', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c2', toolName: 'write', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c3', toolName: 'read', input: {}, status: 'completed' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    expect(screen.getByText('3 items')).toBeDefined();
  });

  it('respects maxEntries prop', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'tool_use', callId: 'c1', toolName: 'a', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c2', toolName: 'b', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c3', toolName: 'c', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c4', toolName: 'd', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c5', toolName: 'e', input: {}, status: 'completed' },
    ];
    render(<ToolTimeline blocks={blocks as any} maxEntries={2} />);
    const entries = screen.getAllByTestId('tool-timeline-entry');
    expect(entries).toHaveLength(2);
  });

  it('applies custom labels', () => {
    const labels: ToolTimelineLabels = {
      header: 'Agent Timeline',
      statusCompleted: 'success',
      statusFailed: 'error',
    };
    const blocks: ToolTimelineBlock[] = [
      { kind: 'tool_use', callId: 'c1', toolName: 'test', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c2', toolName: 'fail', input: {}, status: 'failed' },
    ];
    render(<ToolTimeline blocks={blocks as any} labels={labels} />);
    expect(screen.getByText('Agent Timeline')).toBeDefined();
    expect(screen.getByText('success')).toBeDefined();
    expect(screen.getByText('error')).toBeDefined();
  });

  it('supports custom headerCount as a function', () => {
    const labels: ToolTimelineLabels = {
      headerCount: (count: number) => `total: ${count}`,
    };
    const blocks: ToolTimelineBlock[] = [
      { kind: 'tool_use', callId: 'c1', toolName: 'a', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c2', toolName: 'b', input: {}, status: 'completed' },
    ];
    render(<ToolTimeline blocks={blocks as any} labels={labels} />);
    expect(screen.getByText('total: 2')).toBeDefined();
  });

  it('applies className to root', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'tool_use', callId: 'c1', toolName: 't1', input: {}, status: 'completed' },
      { kind: 'tool_use', callId: 'c2', toolName: 't2', input: {}, status: 'completed' },
    ];
    render(<ToolTimeline blocks={blocks as any} className="custom-timeline" />);
    expect(screen.getByTestId('tool-timeline').className).toContain('custom-timeline');
  });

  it('ignores unknown block kinds', () => {
    const blocks = [
      { kind: 'text', content: 'Hello' },
      { kind: 'tool_use', callId: 'c1', toolName: 'bash', input: {}, status: 'completed' },
      { kind: 'code', language: 'ts', content: 'x' },
      { kind: 'tool_use', callId: 'c2', toolName: 'write', input: {}, status: 'running' },
    ] as readonly { kind?: string; [key: string]: unknown }[];
    render(<ToolTimeline blocks={blocks as any} />);
    // Only the two tool_use blocks should render
    const entries = screen.getAllByTestId('tool-timeline-entry');
    expect(entries).toHaveLength(2);
  });

  it('summarizes tool input with file_path, path, command, description', () => {
    const blocks: ToolTimelineBlock[] = [
      {
        kind: 'tool_use',
        callId: 'c1',
        toolName: 'tool',
        input: { file_path: '/src/app.ts', command: 'npm test', description: 'run all tests' },
        status: 'completed',
      },
      { kind: 'tool_use', callId: 'c2', toolName: 'tool2', input: {}, status: 'completed' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    // meta should contain file_path and truncated command/description
    expect(screen.getByText(/\/src\/app\.ts/)).toBeDefined();
  });

  it('renders route_decision with completed status when not blocked', () => {
    const blocks: ToolTimelineBlock[] = [
      { kind: 'route_decision', action: 'reroute', instructions: 'Go here' },
      { kind: 'route_decision', action: 'block', blockedReason: 'Nope' },
    ];
    render(<ToolTimeline blocks={blocks as any} />);
    // Unblocked route should show "done", blocked should show "failed"
    expect(screen.getByText('done')).toBeDefined();
    expect(screen.getByText('failed')).toBeDefined();
  });
});
