import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CollapsibleBlock } from './CollapsibleBlock';

const meta: Meta<typeof CollapsibleBlock> = {
  title: 'UI/CollapsibleBlock',
  component: CollapsibleBlock,
  argTypes: {
    colorScheme: { control: 'select', options: ['default', 'blue', 'green', 'amber', 'purple', 'red'] },
    defaultExpanded: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof CollapsibleBlock>;

export const Collapsed: Story = {
  args: {
    label: 'Tool: Read',
    badge: 'READ',
    icon: 'description',
    colorScheme: 'blue',
    preview: '/src/components/Button.tsx\n/src/components/Card.tsx',
    children: 'Full content of the read operation...',
  },
};

export const Expanded: Story = {
  args: {
    label: 'Session initialized',
    icon: 'smart_toy',
    colorScheme: 'green',
    defaultExpanded: true,
    children: 'Model: claude-sonnet-4-6\nTools: read, write, edit, bash, grep',
  },
};

export const ErrorBlock: Story = {
  args: {
    label: 'Run failed',
    badge: 'ERROR',
    icon: 'error',
    colorScheme: 'red',
    defaultExpanded: true,
    children: 'Error: Connection timeout after 30s',
  },
};

export const Thinking: Story = {
  args: {
    label: 'Thinking...',
    icon: 'psychology',
    colorScheme: 'purple',
    preview: 'Let me analyze the codebase structure first.\nLooking at the imports...',
    children: 'Let me analyze the codebase structure first.\nLooking at the imports, I can see this is a React project.\nThe component uses forwardRef for ref forwarding.',
  },
};
