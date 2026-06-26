import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
