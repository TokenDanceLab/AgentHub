import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { RecoveryPanel } from './RecoveryPanel';

const meta: Meta<typeof RecoveryPanel> = {
  title: 'UI/RecoveryPanel',
  component: RecoveryPanel,
};

export default meta;
type Story = StoryObj<typeof RecoveryPanel>;

export const Basic: Story = {
  args: {
    icon: '!',
    eyebrow: 'Workflow recovery',
    title: 'Threads could not sync',
    description: 'Hub health is reachable, but workflow endpoints did not return JSON.',
    meta: 'Last attempt 09:00',
    primaryAction: { label: 'Retry', onClick: () => undefined },
    secondaryAction: { label: 'Account', onClick: () => undefined },
  },
};
