import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('carries the selectable identity and context-menu trigger on agent text bubbles (#1821)', () => {
    const item: TranscriptAgentItem = {
      id: 'agent-bubble-selectable',
      agent: 'Builder',
      role: 'agent',
      time: '',
      rows: [],
      standaloneRows: [],
      runs: [],
      bubbles: ['Agent 的文本回复'],
      parts: [
        { type: 'bubble', text: 'Agent 的文本回复', blockId: 'hub-message-9' },
      ],
    };
    const onBlockContextMenu = vi.fn();

    const { container } = render(
      <AgentGroup item={item} chatMode="group" onBlockContextMenu={onBlockContextMenu} />,
    );

    const bubble = container.querySelector('[data-selectable-card="hub-message-9"]');
    expect(bubble).not.toBeNull();
    expect(bubble).toHaveAttribute('data-block-id', 'hub-message-9');

    fireEvent.contextMenu(bubble!);
    expect(onBlockContextMenu).toHaveBeenCalledTimes(1);
    expect(onBlockContextMenu.mock.calls[0]?.[0]).toBe('hub-message-9');
  });

  it('keeps bubbles without a block id or handler free of selectable wiring (#1821)', () => {
    const item: TranscriptAgentItem = {
      id: 'agent-bubble-plain',
      agent: 'Builder',
      role: 'agent',
      time: '',
      rows: [],
      standaloneRows: [],
      runs: [],
      bubbles: ['没有上游 block id 的回复'],
      parts: [
        { type: 'bubble', text: '没有上游 block id 的回复' },
      ],
    };

    const { container } = render(
      <AgentGroup item={item} chatMode="group" onBlockContextMenu={vi.fn()} />,
    );
    expect(container.querySelector('[data-selectable-card]')).toBeNull();
  });

  it('auto-expands fail cards for collapsible non-tool/non-approval/non-sub types', () => {
    const item: TranscriptAgentItem = {
      id: 'agent-fail',
      agent: 'Agent',
      role: 'agent',
      time: '',
      rows: [
        { id: 'preview-fail', type: 'preview', label: 'Deploy', status: 'fail', collapsible: true, content: '部署失败', extra: 'prod.example.com', url: 'https://prod.example.com', previewDomain: 'example.com', previewTitle: 'Example' },
      ],
      standaloneRows: [],
      runs: [],
      bubbles: ['处理失败。'],
    };
    const { container } = render(<AgentGroup item={item} chatMode="group" />);
    const row = container.querySelector('[data-block-id="preview-fail"]');
    expect(row).not.toBeNull();
    expect(row!.classList.contains('open')).toBe(true);
  });

  it('auto-opens think card when status is running', () => {
    const item: TranscriptAgentItem = {
      id: 'agent-think-open',
      agent: 'Agent',
      role: 'agent',
      time: '',
      rows: [
        { id: 'think-open', type: 'think', label: '思考', status: 'running', collapsible: true, content: '…' },
      ],
      standaloneRows: [],
      runs: [],
      bubbles: [],
    };
    const { container } = render(<AgentGroup item={item} chatMode="group" />);
    const row = container.querySelector('[data-block-id="think-open"]');
    expect(row).not.toBeNull();
    expect(row!.classList.contains('open')).toBe(true);
  });

  it('auto-collapses think card 1s after status changes from running to ok', () => {
    vi.useFakeTimers();
    try {
      const runningItem: TranscriptAgentItem = {
        id: 'agent-think-delay',
        agent: 'Agent',
        role: 'agent',
        time: '',
        rows: [
          { id: 'think-delay', type: 'think', label: '思考', status: 'running', collapsible: true, content: '…' },
        ],
        standaloneRows: [],
        runs: [],
        bubbles: [],
      };
      const { container, rerender } = render(<AgentGroup item={runningItem} chatMode="group" />);
      const row = container.querySelector('[data-block-id="think-delay"]');
      expect(row!.classList.contains('open')).toBe(true);

      // Change to ok — should stay open within 1s delay
      const okItem: TranscriptAgentItem = {
        ...runningItem,
        rows: [
          { id: 'think-delay', type: 'think', label: '思考', status: 'ok', collapsible: true, content: 'done' },
        ],
      };
      rerender(<AgentGroup item={okItem} chatMode="group" />);
      expect(row!.classList.contains('open')).toBe(true);

      // Advance past 1s threshold (wrapped in act to flush React state)
      act(() => { vi.advanceTimersByTime(1000); });
      expect(row!.classList.contains('open')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-collapse think card after user manual toggle (once semantics)', () => {
    vi.useFakeTimers();
    try {
      const runningItem: TranscriptAgentItem = {
        id: 'agent-think-once',
        agent: 'Agent',
        role: 'agent',
        time: '',
        rows: [
          { id: 'think-once', type: 'think', label: '思考', status: 'running', collapsible: true, content: '…' },
        ],
        standaloneRows: [],
        runs: [],
        bubbles: [],
      };
      const { container, rerender } = render(<AgentGroup item={runningItem} chatMode="group" />);
      const row = container.querySelector('[data-block-id="think-once"]');
      expect(row!.classList.contains('open')).toBe(true);

      // Change to ok — user clicks manually within 1s window
      const okItem: TranscriptAgentItem = {
        ...runningItem,
        rows: [
          { id: 'think-once', type: 'think', label: '思考', status: 'ok', collapsible: true, content: 'done' },
        ],
      };
      rerender(<AgentGroup item={okItem} chatMode="group" />);
      expect(row!.classList.contains('open')).toBe(true);

      // User clicks the header (manual toggle — now allowed since not running)
      const header = row!.querySelector('.row-hd');
      expect(header).not.toBeNull();
      fireEvent.click(header!);

      // Card should be closed now (user toggled)
      expect(row!.classList.contains('open')).toBe(false);

      // User re-opens
      fireEvent.click(header!);
      expect(row!.classList.contains('open')).toBe(true);

      // Advance past 1s — should NOT auto-collapse because once semantics
      act(() => { vi.advanceTimersByTime(2000); });
      expect(row!.classList.contains('open')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AgentGroup fenced code (#1971)', () => {
  it('renders agent fenced code bubbles as code blocks', () => {
    const item: TranscriptAgentItem = {
      id: 'agent-fenced',
      agent: 'Hub Agent',
      role: 'agent',
      time: '',
      rows: [],
      standaloneRows: [],
      runs: [],
      parts: [
        {
          type: 'bubble',
          text: 'Here is a fenced code sample:\n```python\ndef greet():\n    return 42\n```\n',
          blockId: 'hub-message-m2',
        },
      ],
      bubbles: ['Here is a fenced code sample:\n```python\ndef greet():\n    return 42\n```\n'],
    };

    const { container, getByText } = render(<AgentGroup item={item} chatMode="dm" />);

    expect(getByText('Here is a fenced code sample:')).toBeInTheDocument();
    expect(container.textContent).toContain('return 42');
    expect(container.querySelectorAll('pre, code, [class*="codeBlockWrapper"]').length).toBeGreaterThan(0);
  });
});
