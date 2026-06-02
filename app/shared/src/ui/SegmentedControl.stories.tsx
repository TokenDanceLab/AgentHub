import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Play, ShieldAlert, TerminalSquare } from 'lucide-react';
import { SegmentedControl } from './SegmentedControl';

const meta: Meta<typeof SegmentedControl> = {
  title: 'UI/SegmentedControl',
  component: SegmentedControl,
};

export default meta;
type Story = StoryObj<typeof SegmentedControl>;

export const QueueFilters: Story = {
  args: {
    ariaLabel: 'Run filters',
    value: 'all',
    options: [
      { value: 'all', label: 'All', meta: 3, icon: <Play size={14} /> },
      { value: 'review', label: 'Review', meta: 1, icon: <ShieldAlert size={14} /> },
      { value: 'active', label: 'Active', meta: 2, icon: <TerminalSquare size={14} /> },
    ],
    onChange: () => undefined,
  },
};
