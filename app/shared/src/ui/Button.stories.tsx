import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'destructive', 'gradient', 'icon'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { children: 'Primary Button', variant: 'primary', size: 'md' } };
export const Secondary: Story = { args: { children: 'Secondary', variant: 'secondary' } };
export const Ghost: Story = { args: { children: 'Ghost', variant: 'ghost' } };
export const Destructive: Story = { args: { children: 'Delete', variant: 'destructive' } };
export const Gradient: Story = { args: { children: 'Gradient CTA', variant: 'gradient' } };
export const Icon: Story = { args: { children: '🔔', variant: 'icon', 'aria-label': 'Notifications' } };
export const Small: Story = { args: { children: 'Small', size: 'sm' } };
export const Large: Story = { args: { children: 'Large', size: 'lg' } };
export const Disabled: Story = { args: { children: 'Disabled', disabled: true } };
