import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Clock3, MessageSquare } from 'lucide-react';
import { ActionList } from './ActionList';

const meta: Meta<typeof ActionList> = {
  title: 'UI/ActionList',
  component: ActionList,
};

export default meta;
type Story = StoryObj<typeof ActionList>;

export const QueueRows: Story = {
  args: {
    items: [
      {
        id: 'thread-1',
        icon: <MessageSquare size={18} />,
        title: 'Review approval copy on mobile',
        meta: ['agenthub-mobile', <><Clock3 size={12} /> May 27</>],
        trailing: 'Online',
      },
    ],
  },
};
