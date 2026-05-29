import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { GitPullRequestArrow } from 'lucide-react';
import { ActivityCard } from './ActivityCard';

const meta: Meta<typeof ActivityCard> = {
  title: 'UI/ActivityCard',
  component: ActivityCard,
};

export default meta;
type Story = StoryObj<typeof ActivityCard>;

export const DiffActivity: Story = {
  args: {
    icon: <GitPullRequestArrow size={16} />,
    label: 'Diff',
    meta: '09:22',
    children: 'Updated mobile copy and approval panel states.',
  },
};

export const RunBlock: Story = {
  args: {
    leading: '1',
    icon: <GitPullRequestArrow size={16} />,
    label: 'diff',
    children: 'Updated mobile approval panel states.',
    actions: <button type="button">Inspect</button>,
  },
};

export const BodyWithState: Story = {
  args: {
    label: 'Account',
    children: 'TokenDance ID session surface',
    actions: <span>Ready</span>,
  },
};
