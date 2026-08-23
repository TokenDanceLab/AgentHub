import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from './Textarea';
import { FormField } from './FormField';

const meta: Meta<typeof Textarea> = {
  title: 'UI/Form/Textarea',
  component: Textarea,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md'] },
    invalid: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: 'Multiline notes…' },
};

export const Compact: Story = {
  args: { placeholder: 'Compact multiline', size: 'sm' },
};

export const Invalid: Story = {
  args: { placeholder: 'Too long', invalid: true },
};

export const Disabled: Story = {
  args: { placeholder: 'Disabled', disabled: true },
};

export const InFormField: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <FormField label="Release notes" hint="Markdown supported" required>
        <Textarea defaultValue="Highlights of this release…" rows={4} />
      </FormField>
      <FormField label="Commit message" error="Message exceeds 72 chars">
        <Textarea defaultValue="feat: this commit message is much too long for a line" rows={3} />
      </FormField>
    </div>
  ),
};
