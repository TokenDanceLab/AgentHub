import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { MetricGrid } from './MetricGrid';

const meta: Meta<typeof MetricGrid> = {
  title: 'UI/MetricGrid',
  component: MetricGrid,
};

export default meta;
type Story = StoryObj<typeof MetricGrid>;

export const QueueOverview: Story = {
  args: {
    items: [
      { id: 'active', value: 2, label: 'Active' },
      { id: 'review', value: 1, label: 'Review' },
      { id: 'total', value: 3, label: 'Total' },
    ],
  },
};
