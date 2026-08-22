import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TranscriptUserItem } from '../transcript-item';
import { UserMessage } from './UserMessage';

describe('UserMessage rendering', () => {
  it('renders user markdown tables through the shared markdown renderer', () => {
    const item: TranscriptUserItem = {
      type: 'user',
      name: 'Ding',
      text: '| Scope | Status |\n| --- | --- |\n| Desktop/Web | aligned |',
    };

    const { container, getByText } = render(<UserMessage item={item} chatMode="dm" />);

    expect(container.querySelector('table')).not.toBeNull();
    expect(getByText('Desktop/Web')).toBeInTheDocument();
    expect(getByText('aligned')).toBeInTheDocument();
  });

  it('renders Hub message display metadata on user input cards', () => {
    const item: TranscriptUserItem = {
      type: 'user',
      name: 'Ding',
      text: '@Reviewer 帮我复核这个改动',
      displayTitle: 'Group @Agent',
      displayDetail: 'IM project_group · mentions @Reviewer · task task-reviewer-1',
      badgeLabel: '@Agent queued',
      badgeVariant: 'primary',
    };

    const { getByText } = render(<UserMessage item={item} chatMode="group" />);

    expect(getByText('Group @Agent')).toBeInTheDocument();
    expect(getByText('IM project_group · mentions @Reviewer · task task-reviewer-1')).toBeInTheDocument();
    expect(getByText('@Agent queued')).toBeInTheDocument();
    expect(getByText('@Reviewer 帮我复核这个改动')).toBeInTheDocument();
  });

  // #1821: text bubbles were the only transcript cards without a selectable
  // identity or a context-menu entry point — tool rows carried both via
  // RowItem. The user bubble now matches that contract.
  it('carries the selectable identity and fires the context-menu handler', () => {
    const item: TranscriptUserItem = {
      type: 'user',
      id: 'hub-message-1',
      name: 'Ding',
      text: '来自 Hub 的消息',
    };
    const onContextMenu = vi.fn();

    const { container } = render(
      <UserMessage item={item} chatMode="group" onContextMenu={onContextMenu} />,
    );

    const bubble = container.querySelector('[data-selectable-card="hub-message-1"]');
    expect(bubble).not.toBeNull();
    expect(bubble).toHaveAttribute('data-block-id', 'hub-message-1');

    fireEvent.contextMenu(bubble!);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0]?.[0]).toBe('hub-message-1');
  });

  it('stays inert without a block id or without a context-menu handler', () => {
    const noId: TranscriptUserItem = { type: 'user', text: '无 id 的消息' };
    const onContextMenu = vi.fn();
    const { container } = render(
      <UserMessage item={noId} chatMode="dm" onContextMenu={onContextMenu} />,
    );
    expect(container.querySelector('[data-selectable-card]')).toBeNull();

    const noHandler: TranscriptUserItem = { type: 'user', id: 'hub-message-2', text: '有 id 的消息' };
    const { container: bare } = render(<UserMessage item={noHandler} chatMode="dm" />);
    expect(bare.querySelector('[data-selectable-card]')).toBeNull();
  });
});
