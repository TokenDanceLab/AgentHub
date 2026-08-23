import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './Input';
import { FormField } from './FormField';

const meta: Meta<typeof Input> = {
  title: 'UI/Form/Input',
  component: Input,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md'] },
    invalid: { control: 'boolean' },
    mono: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { placeholder: 'Type something…' },
};

export const Compact: Story = {
  args: { placeholder: 'Compact field', size: 'sm' },
};

export const MonoUrl: Story = {
  args: { placeholder: 'http://localhost:8080', size: 'sm', mono: true },
};

export const Invalid: Story = { args: { placeholder: 'Bad value', invalid: true } };

export const Disabled: Story = { args: { placeholder: 'Disabled', disabled: true } };

export const InFormField: Story = {
  render: () => (
    <div style={{ width: 280 }}>
      <FormField label="Hub URL" hint="REST endpoint" required>
        <Input placeholder="http://localhost:8080" size="sm" mono />
      </FormField>
      <FormField label="API key" error="Invalid key format">
        <Input defaultValue="sk-x" size="sm" mono />
      </FormField>
    </div>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = useState('');
    return (
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Controlled"
        aria-label="Controlled"
      />
    );
  },
};
