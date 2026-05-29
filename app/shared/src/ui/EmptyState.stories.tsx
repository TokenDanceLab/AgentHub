import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Basic: Story = {
  args: {
    title: 'No thread selected',
    description: 'Pick a thread first, then continue the conversation.',
  },
};

export const WithAction: Story = {
  args: {
    title: 'No thread selected',
    description: 'Browse active handoff threads.',
    action: { label: 'Browse threads', onClick: () => undefined },
  },
};

export const WithSuggestions: Story = {
  args: {
    title: 'What can I help you build today?',
    description: 'Choose a prompt starter or write your own task.',
    suggestions: [
      { label: 'New task', onClick: () => undefined },
      { label: 'Explain code', onClick: () => undefined },
      { label: 'Fix bugs', onClick: () => undefined },
    ],
  },
};
