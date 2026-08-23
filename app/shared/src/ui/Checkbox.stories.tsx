import type { Meta, StoryObj } from '@storybook/react';
import { Checkbox } from './Checkbox';
import { FormField } from './FormField';

const meta: Meta<typeof Checkbox> = {
  title: 'UI/Form/Checkbox',
  component: Checkbox,
  argTypes: {
    invalid: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  args: { label: 'Receive release emails', checked: false, onChange: () => {} },
};

export const Checked: Story = {
  args: { label: 'Receive release emails', checked: true, onChange: () => {} },
};

export const Invalid: Story = {
  args: { label: 'Accept terms', checked: false, invalid: true, onChange: () => {} },
};

export const Disabled: Story = {
  args: { label: 'Locked preference', checked: true, disabled: true, onChange: () => {} },
};

export const InFormField: Story = {
  render: () => (
    <FormField label="Notifications">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Checkbox label="Release emails" checked onChange={() => {}} />
        <Checkbox label="Weekly digest" checked={false} onChange={() => {}} />
      </div>
    </FormField>
  ),
};
