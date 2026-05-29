import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { RefreshCw } from 'lucide-react';
import { StatusNotice } from './StatusNotice';

const meta: Meta<typeof StatusNotice> = {
  title: 'UI/StatusNotice',
  component: StatusNotice,
};

export default meta;
type Story = StoryObj<typeof StatusNotice>;

export const Online: Story = {
  args: {
    icon: <RefreshCw size={14} />,
    children: 'Hub workflow is online.',
  },
};
