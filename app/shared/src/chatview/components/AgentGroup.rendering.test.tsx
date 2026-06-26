import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TranscriptAgentItem } from '../transcript-item';
import { AgentGroup } from './AgentGroup';

describe('AgentGroup rendering', () => {
  it('renders agent markdown tables and keeps run-only evidence out of the chat body', () => {
    const item: TranscriptAgentItem = {
      id: 'agent-1',
      agent: 'Agent',
      role: 'agent',
      time: '',
      rows: [],
      standaloneRows: [],
      runs: [],
      bubbles: ['| Agent | Task |\n| --- | --- |\n| Builder | Fix CSS |'],
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
      ],
    };

    const { container, queryByText } = render(<AgentGroup item={item} chatMode="group" />);

    expect(container.querySelector('table')).not.toBeNull();
    expect(queryByText('Run run-1')).toBeNull();
  });

  it('renders mixed tool cards and bubbles in transcript order', () => {
    const item: TranscriptAgentItem = {
      id: 'agent-ordered',
      agent: 'Agent',
      role: 'agent',
      time: '',
      rows: [
        { id: 'tool-read', type: 'tool', label: 'Read', status: 'ok', collapsible: true, toolName: 'read' },
        { id: 'tool-glob', type: 'tool', label: 'Glob', status: 'running', collapsible: true, toolName: 'glob' },
      ],
      standaloneRows: [],
      runs: [],
      bubbles: ['我先定位 AgentHub 项目。'],
      parts: [
        { type: 'row', row: { id: 'tool-read', type: 'tool', label: 'Read', status: 'ok', collapsible: true, toolName: 'read' } },
        { type: 'bubble', text: '我先定位 AgentHub 项目。' },
        { type: 'row', row: { id: 'tool-glob', type: 'tool', label: 'Glob', status: 'running', collapsible: true, toolName: 'glob' } },
      ],
    };

    const { container, getByText } = render(<AgentGroup item={item} chatMode="group" />);
    const read = container.querySelector('[data-block-id="tool-read"]');
    const bubble = getByText('我先定位 AgentHub 项目。');
    const glob = container.querySelector('[data-block-id="tool-glob"]');

    expect(read).not.toBeNull();
    expect(glob).not.toBeNull();
    expect(read!.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bubble.compareDocumentPosition(glob!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders Hub display metadata on agent reply cards without replacing the reply body', () => {
    const item: TranscriptAgentItem = {
      id: 'agent-meta',
      agent: 'Reviewer',
      role: 'agent',
      time: '',
      rows: [],
      standaloneRows: [],
      runs: [],
      bubbles: ['我会检查这次 Desktop/Web 聊天流。'],
      displayTitle: 'Agent -> Agent',
      displayDetail: 'IM agent_dm · Builder -> Reviewer · task task-reviewer-1',
      badgeLabel: '@Agent running',
      badgeVariant: 'thinking',
    };

    const { getByText } = render(<AgentGroup item={item} chatMode="group" />);

    expect(getByText('Agent -> Agent')).toBeInTheDocument();
    expect(getByText('IM agent_dm · Builder -> Reviewer · task task-reviewer-1')).toBeInTheDocument();
    expect(getByText('@Agent running')).toBeInTheDocument();
    expect(getByText('我会检查这次 Desktop/Web 聊天流。')).toBeInTheDocument();
  });
});
