import type { Meta, StoryObj } from '@storybook/react';
import { FormField } from './FormField';
import { Input } from './Input';

const meta: Meta<typeof FormField> = {
  title: 'UI/Form/FormField',
  component: FormField,
};

export default meta;
type Story = StoryObj<typeof FormField>;

export const Default: Story = {
  args: {},
  render: (args) => (
    <FormField label="Display name" hint="Shown to teammates" {...args}>
      <Input placeholder="Ada Lovelace" />
    </FormField>
  ),
};

export const Error: Story = {
  args: { label: 'Display name', error: 'Display name is required' },
  render: (args) => (
    <FormField {...args}>
      <Input placeholder="Ada Lovelace" />
    </FormField>
  ),
};

export const Required: Story = {
  args: { label: 'Display name', required: true },
  render: (args) => (
    <FormField {...args}>
      <Input placeholder="Ada Lovelace" />
    </FormField>
  ),
};
