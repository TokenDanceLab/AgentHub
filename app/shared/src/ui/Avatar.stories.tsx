import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Avatar } from './Avatar';

const meta: Meta<typeof Avatar> = {
  title: 'UI/Avatar',
  component: Avatar,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    variant: { control: 'select', options: ['default', 'brand'] },
  },
};

export default meta;
type Story = StoryObj<typeof Avatar>;

export const Default: Story = { args: { initials: 'JD', size: 'md' } };
export const Brand: Story = { args: { initials: 'AH', variant: 'brand', size: 'lg' } };
export const Small: Story = { args: { initials: 'XS', size: 'sm' } };
export const Large: Story = { args: { initials: 'XL', size: 'lg' } };
