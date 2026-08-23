import type { Meta, StoryObj } from '@storybook/react';
import { Tooltip } from './Tooltip';
import { Button } from './Button';

const meta: Meta<typeof Tooltip> = {
  title: 'UI/Tooltip',
  component: Tooltip,
  argTypes: {
    side: { control: 'select', options: ['top', 'right', 'bottom', 'left'] },
    delayMs: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Bottom: Story = {
  args: { label: 'Deploy release', side: 'bottom', delayMs: 0 },
  render: (args) => (
    <Tooltip {...args}>
      <Button variant="secondary" size="sm">Hover or focus me</Button>
    </Tooltip>
  ),
};

export const Top: Story = {
  args: { label: 'Top side tooltip', side: 'top', delayMs: 0 },
  render: (args) => (
    <Tooltip {...args}>
      <Button variant="secondary" size="sm">Hover or focus me</Button>
    </Tooltip>
  ),
};

export const Sides: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '2rem' }}>
      <Tooltip label="Top edge" side="top" delayMs={0}>
        <button type="button">Top</button>
      </Tooltip>
      <Tooltip label="Right edge" side="right" delayMs={0}>
        <button type="button">Right</button>
      </Tooltip>
      <Tooltip label="Bottom edge" side="bottom" delayMs={0}>
        <button type="button">Bottom</button>
      </Tooltip>
      <Tooltip label="Left edge" side="left" delayMs={0}>
        <button type="button">Left</button>
      </Tooltip>
    </div>
  ),
};

export const HoverDelay: Story = {
  args: { label: 'Appears after 900ms', delayMs: 900 },
  render: (args) => (
    <Tooltip {...args}>
      <button type="button">Hover slowly</button>
    </Tooltip>
  ),
};

export const IconButtonTarget: Story = {
  render: () => (
    <Tooltip label="Copy artifact link">
      <button type="button" aria-label="Copy artifact link">🔗</button>
    </Tooltip>
  ),
};
