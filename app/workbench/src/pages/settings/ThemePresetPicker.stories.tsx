import type { Meta, StoryObj } from '@storybook/react';
import { ThemePresetPicker } from './ThemePresetPicker';

const meta: Meta<typeof ThemePresetPicker> = {
  title: 'Workbench/Settings/ThemePresetPicker',
  component: ThemePresetPicker,
  args: {
    groupLabel: 'Theme preset selection',
    defaultLabel: 'Default',
  },
};

export default meta;
type Story = StoryObj<typeof ThemePresetPicker>;

export const Default: Story = {};
