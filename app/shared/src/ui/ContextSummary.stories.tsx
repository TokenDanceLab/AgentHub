import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ContextSummary } from './ContextSummary';

const meta: Meta<typeof ContextSummary> = {
  title: 'UI/ContextSummary',
  component: ContextSummary,
};

export default meta;
type Story = StoryObj<typeof ContextSummary>;

export const ThreadContext: Story = {
  args: {
    eyebrow: 'Thread context',
    title: 'Review approval copy on mobile',
    items: [
      { id: 'status', label: 'Status', value: 'online' },
      { id: 'messages', label: 'Messages', value: 4 },
      { id: 'updated', label: 'Updated', value: 'May 27, 09:22' },
    ],
  },
};

export const RouteContext: Story = {
  args: {
    eyebrow: 'Route context',
    title: 'Workspace',
    description: 'Desktop-style command surface for active agents and threads.',
    items: [
      { id: 'agents', label: 'Agents', value: 3 },
      { id: 'threads', label: 'Threads', value: 8 },
      { id: 'source', label: 'Source', value: 'Shell' },
    ],
    actions: <button type="button">Open messages</button>,
  },
};
