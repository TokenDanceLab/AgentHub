import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ProgressBar } from './ProgressBar';

const meta: Meta<typeof ProgressBar> = {
  title: 'UI/ProgressBar',
  component: ProgressBar,
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100 } },
    paused: { control: 'boolean' },
    label: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const Half: Story = { args: { value: 50 } };
export const Complete: Story = { args: { value: 100, label: 'Done' } };
export const Low: Story = { args: { value: 15, label: '15% complete' } };
export const Paused: Story = { args: { value: 30, paused: true, label: 'Paused' } };
