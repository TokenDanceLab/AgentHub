import type { Meta, StoryObj } from '@storybook/react';
import { RiskBadge } from './RiskBadge';

const meta: Meta<typeof RiskBadge> = {
  title: 'UI/RiskBadge',
  component: RiskBadge,
  argTypes: {
    level: { control: 'select', options: ['low', 'medium', 'high', 'critical'] },
  },
};

export default meta;
type Story = StoryObj<typeof RiskBadge>;

export const Low: Story = { args: { level: 'low', children: 'Low risk' } };
export const Medium: Story = { args: { level: 'medium', children: 'Medium risk' } };
export const High: Story = { args: { level: 'high', children: 'High risk' } };
export const Critical: Story = { args: { level: 'critical', children: 'Critical risk' } };
