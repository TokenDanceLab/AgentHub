import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { RefreshCw } from 'lucide-react';
import { SectionHeader } from './SectionHeader';

const meta: Meta<typeof SectionHeader> = {
  title: 'UI/SectionHeader',
  component: SectionHeader,
};

export default meta;
type Story = StoryObj<typeof SectionHeader>;

export const WithRefresh: Story = {
  args: {
    eyebrow: 'Threads',
    title: 'Queue overview',
    action: {
      ariaLabel: 'Refresh threads',
      icon: <RefreshCw size={18} />,
    },
  },
};
