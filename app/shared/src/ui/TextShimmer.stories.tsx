import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { TextShimmer } from './TextShimmer';

const meta: Meta<typeof TextShimmer> = {
  title: 'UI/TextShimmer',
  component: TextShimmer,
};

export default meta;
type Story = StoryObj<typeof TextShimmer>;

export const Default: Story = { args: { bars: 3 } };
export const WithLabel: Story = { args: { bars: 4, label: 'Loading response...' } };
export const Single: Story = { args: { bars: 1 } };
