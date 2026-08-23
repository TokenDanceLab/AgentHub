import type { Meta, StoryObj } from '@storybook/react';
import { TokenDanceMark } from './TokenDanceMark';

const meta: Meta<typeof TokenDanceMark> = {
  title: 'UI/TokenDanceMark',
  component: TokenDanceMark,
  argTypes: {
    width: { control: 'text' },
    height: { control: 'text' },
    alt: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof TokenDanceMark>;

export const Default: Story = { args: { width: 64, height: 64 } };
export const Small: Story = { args: { width: 24, height: 24 } };
export const CustomAlt: Story = { args: { width: 48, height: 48, alt: 'TokenDance icon' } };
