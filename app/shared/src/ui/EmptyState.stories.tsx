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
    title: 'Start a Conversation',
    description: 'Ask a question to start chatting with AI.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 12a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H18l-8 6V34h-0a4 4 0 0 1-4-4V12z" />
        <circle cx="18" cy="21" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="24" cy="21" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="30" cy="21" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
    action: { label: 'New Thread', onClick: () => undefined, shortcut: 'Ctrl+N' },
  },
};

export const WithSuggestions: Story = {
  args: {
    title: 'Ready to Go',
    description: 'Choose a prompt starter or write your own task.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M26 6L12 28h10l-2 14L34 20H24l2-14z" />
      </svg>
    ),
    suggestions: [
      { label: 'New task', onClick: () => undefined },
      { label: 'Explain code', onClick: () => undefined },
      { label: 'Fix bugs', onClick: () => undefined },
    ],
  },
};

export const RunListEmpty: Story = {
  args: {
    title: 'No Run History',
    description: 'Task progress will appear here once started.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="24" cy="24" r="16" />
        <path d="M20 16l12 8-12 8V16z" fill="currentColor" stroke="none" opacity="0.15" />
        <path d="M20 16l12 8-12 8V16z" />
      </svg>
    ),
  },
};
