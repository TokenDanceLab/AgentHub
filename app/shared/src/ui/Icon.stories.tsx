import type { Meta, StoryObj } from '@storybook/react';
import { Icon } from './Icon';

const meta: Meta<typeof Icon> = {
  title: 'UI/Icon',
  component: Icon,
  argTypes: {
    name: { control: 'text' },
    size: { control: 'number' },
    filled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Icon>;

export const Default: Story = { args: { name: 'check_circle' } };
export const Filled: Story = { args: { name: 'star', filled: true } };
export const Large: Story = { args: { name: 'rocket_launch', size: 32 } };
export const Decorative: Story = { args: { name: 'info', 'aria-hidden': true } };
