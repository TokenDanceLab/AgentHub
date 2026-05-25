import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Pill } from './Pill';

const meta: Meta<typeof Pill> = {
  title: 'UI/Pill',
  component: Pill,
  argTypes: {
    variant: { control: 'select', options: ['default', 'blue', 'cyan', 'purple', 'green', 'amber'] },
  },
};

export default meta;
type Story = StoryObj<typeof Pill>;

export const Default: Story = { args: { children: 'Default' } };
export const Blue: Story = { args: { children: 'Engineering', variant: 'blue' } };
export const Cyan: Story = { args: { children: 'Active', variant: 'cyan' } };
export const Purple: Story = { args: { children: 'Design', variant: 'purple' } };
export const Green: Story = { args: { children: 'Success', variant: 'green' } };
export const Amber: Story = { args: { children: 'Warning', variant: 'amber' } };
