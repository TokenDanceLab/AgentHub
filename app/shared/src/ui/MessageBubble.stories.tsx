import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy } from 'lucide-react';
import { MessageBubble } from './MessageBubble';

const meta: Meta<typeof MessageBubble> = {
  title: 'UI/MessageBubble',
  component: MessageBubble,
};

export default meta;
type Story = StoryObj<typeof MessageBubble>;

export const User: Story = {
  render: () => (
    <MessageBubble
      author="User"
      timestamp="09:20"
      align="end"
      actions={<button type="button"><Copy size={14} /> Copy</button>}
    >
      Keep Web and Mobile aligned with the Desktop glass shell.
    </MessageBubble>
  ),
};
