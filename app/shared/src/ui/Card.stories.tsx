import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardHeader, CardContent, CardFooter } from './Card';
import { Button } from './Button';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  argTypes: {
    variant: { control: 'select', options: ['default', 'glass', 'elevated'] },
    padding: { control: 'select', options: ['normal', 'compact', 'none'] },
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: { children: 'Simple card content', variant: 'default' },
};

export const Glass: Story = {
  args: { children: 'Glass morphism card', variant: 'glass' },
};

export const Elevated: Story = {
  args: { children: 'Elevated card with shadow', variant: 'elevated' },
};

export const WithSections: Story = {
  render: () => (
    <Card variant="glass">
      <CardHeader>Settings</CardHeader>
      <CardContent>Configure your workspace preferences here.</CardContent>
      <CardFooter>
        <Button size="sm" variant="primary">Save</Button>
      </CardFooter>
    </Card>
  ),
};
