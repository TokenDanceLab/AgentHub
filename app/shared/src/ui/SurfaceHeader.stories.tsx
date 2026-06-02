import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SurfaceHeader } from './SurfaceHeader';

const meta: Meta<typeof SurfaceHeader> = {
  title: 'UI/SurfaceHeader',
  component: SurfaceHeader,
};

export default meta;
type Story = StoryObj<typeof SurfaceHeader>;

export const Connected: Story = {
  args: {
    eyebrow: 'AgentHub',
    title: 'Runs',
    status: {
      label: 'Connected',
      tone: 'online',
    },
  },
};
