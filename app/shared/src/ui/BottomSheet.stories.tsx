import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { BottomSheet } from './BottomSheet';

const meta: Meta<typeof BottomSheet> = {
  title: 'UI/BottomSheet',
  component: BottomSheet,
};

export default meta;
type Story = StoryObj<typeof BottomSheet>;

export const Basic: Story = {
  args: {
    ariaLabel: 'Confirm approval decision',
    title: 'Confirm approval decision',
    closeLabel: 'Close approval decision',
    eyebrow: 'Approve',
    description: 'Confirm approve for this checkpoint.',
    onClose: () => undefined,
    footer: (
      <>
        <button type="button">Cancel</button>
        <button type="button">Confirm approve</button>
      </>
    ),
  },
};
