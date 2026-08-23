import type { Meta, StoryObj } from '@storybook/react';
import { SkeletonBar } from './SkeletonBar';

const meta: Meta<typeof SkeletonBar> = {
  title: 'UI/SkeletonBar',
  component: SkeletonBar,
  argTypes: {
    variant: { control: 'select', options: ['line', 'circle', 'block'] },
    width: { control: 'text' },
    height: { control: 'text' },
    lines: { control: { type: 'number', min: 1, max: 10 } },
    gap: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof SkeletonBar>;

export const Line: Story = { args: { variant: 'line', lines: 3 } };
export const Circle: Story = { args: { variant: 'circle', width: '2rem', height: '2rem' } };
export const Block: Story = { args: { variant: 'block', height: '5rem' } };
export const Narrow: Story = { args: { variant: 'line', width: '60%', lines: 2 } };
